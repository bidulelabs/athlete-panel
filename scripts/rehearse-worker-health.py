#!/usr/bin/env python3
"""Exercise the packaged worker health check in disposable Docker PID namespaces."""
import argparse
import copy
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
HEALTH_COMMAND = ['CMD', 'pnpm', 'exec', 'tsx', 'scripts/operations.ts', 'worker-health']
# Include threads (the cgroup limit counts tasks) and orphaned zombies separately.
SAMPLE = r"""
const fs = require('node:fs');
const processes = fs.readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(pid => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return [{pid: Number(pid), command: stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')')),
      state: fields[0], parent: Number(fields[1])}];
  } catch { return []; }
});
const paths = ['/sys/fs/cgroup/pids.current', '/sys/fs/cgroup/pids/pids.current'];
const path = paths.find(path => fs.existsSync(path));
if (!path) throw new Error('A PID cgroup is required for this rehearsal');
console.log(JSON.stringify({tasks: Number(fs.readFileSync(path, 'utf8')),
  zombies: processes.filter(p => p.state === 'Z').length,
  orphanZombies: processes.filter(p => p.state === 'Z' && p.parent === 1).length,
  zombieCommands: [...new Set(processes.filter(p => p.state === 'Z').map(p => p.command))],
  pid1: fs.readFileSync('/proc/1/comm', 'utf8').trim()}));
"""


def run(args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, capture_output=True,
                          text=True, timeout=120, **kwargs).stdout.strip()


def inspect(container):
    return json.loads(run(['docker', 'inspect', container]))[0]


def sample(container):
    return json.loads(run(['docker', 'exec', container, 'node', '-e', SAMPLE]))


def collect(container, repetitions, expected, bounded):
    seen = set()
    samples = [sample(container)]
    deadline = time.monotonic() + repetitions * 8 + 30
    while len(seen) < repetitions:
        if time.monotonic() > deadline:
            raise RuntimeError('Timed out waiting for repeated Docker health checks')
        info = inspect(container)
        if not info['State']['Running']:
            raise RuntimeError('The worker fixture exited during health checks')
        logs = info['State'].get('Health', {}).get('Log', [])
        for log in logs:
            if log['End'] in seen:
                continue
            seen.add(log['End'])
            if log['ExitCode'] != expected:
                raise RuntimeError(f'Unexpected health-check result: {log}')
            if expected == -1 and 'Health check exceeded timeout' not in log['Output']:
                raise RuntimeError('Failure did not come from a Docker health-check timeout')
        if logs:
            # Allow asynchronous SIGCHLD delivery/reaping after the probe exits.
            current = sample(container)
            if bounded and current['zombies']:
                for _ in range(10):
                    time.sleep(0.1)
                    current = sample(container)
                    if not current['zombies']:
                        break
            samples.append(current)
            if bounded and (current['zombies'] or current['tasks'] > samples[0]['tasks'] + 48):
                raise RuntimeError(f'Health-check descendants accumulated: {current}; baseline={samples[0]}')
        time.sleep(0.25)
    status = inspect(container)['State']['Health']['Status']
    if status != ('healthy' if expected == 0 else 'unhealthy'):
        raise RuntimeError(f'Unexpected Docker health status: {status}')
    if bounded:
        # A transient probe can use several dozen threads, but between probes the
        # task count must return to the initial parent + sampling process count.
        deadline = time.monotonic() + 10
        while True:
            current = sample(container)
            if current['tasks'] <= samples[0]['tasks'] and current['zombies'] == 0:
                samples.append(current)
                break
            if time.monotonic() > deadline:
                raise RuntimeError(f'Tasks did not return to baseline between probes: {current}')
            time.sleep(0.1)
    return {'checks': len(seen), 'status': status, 'baseline': samples[0],
            'final': samples[-1], 'peakTasks': max(item['tasks'] for item in samples),
            'maxZombies': max(item['zombies'] for item in samples)}


def rehearse(image, repetitions):
    project = 'athlete-panel-health-' + secrets.token_hex(5)
    results = {}
    with tempfile.TemporaryDirectory(prefix=project) as folder:
        stage = Path(folder)
        empty_env = stage / 'empty.env'; empty_env.touch()
        # Resolve the shipped Compose definition without reading owner configuration.
        env = {key: value for key, value in os.environ.items() if not key.startswith('COMPOSE_')}
        env.update(POSTGRES_USER='health_test', POSTGRES_PASSWORD='synthetic-only',
                   POSTGRES_DB='health_test', APP_DATABASE_ROLE='health_test',
                   APP_DATABASE_PASSWORD='synthetic-only', ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
                   ATHLETE_PANEL_DOMAIN='localhost', ATHLETE_PANEL_RELEASE='health-test',
                   BACKUP_KEY_FILE=str(empty_env), BACKUP_DESTINATION=str(stage), BACKUP_HOUR_UTC='3')
        resolved = json.loads(run(['docker', 'compose', '--env-file', empty_env, '-p', project,
                                   '-f', ROOT / 'compose.yml', 'config', '--format', 'json'], env=env))
        worker = resolved['services']['worker']
        if worker.get('init') is not True or worker['healthcheck']['test'] != HEALTH_COMMAND:
            raise RuntimeError('The shipped worker must enable init and retain its health check')
        worker = copy.deepcopy(worker)
        worker.pop('build', None); worker.pop('depends_on', None)
        worker.update(image=image, pull_policy='never', restart='no', pids_limit=256,
                      environment={'DATABASE_URL': 'postgresql://health_test:synthetic-only@db:5432/health_test'})
        # An idle Node parent has the worker's PID/reaping behavior but never schedules
        # provider jobs or rewrites the controlled heartbeat. The probe is unmodified.
        worker['command'] = ['node', '-e', 'setInterval(() => {}, 1000)']
        probe_timeout = worker['healthcheck']['timeout']
        worker['healthcheck'].update(interval='1s', retries=1, start_period='0s')
        config = {'name': project, 'services': {
            'db': {'image': 'postgres:17-alpine', 'environment': {
                'POSTGRES_USER': 'health_test', 'POSTGRES_PASSWORD': 'synthetic-only', 'POSTGRES_DB': 'health_test'},
                'tmpfs': ['/var/lib/postgresql/data'], 'healthcheck': {
                    'test': ['CMD-SHELL', 'pg_isready -U health_test -d health_test'],
                    'interval': '1s', 'timeout': '5s', 'retries': 30}},
            'worker': worker}, 'networks': {'default': {'internal': True}}}
        path = stage / 'compose.json'
        compose = ['docker', 'compose', '-p', project, '-f', path]
        path.write_text(json.dumps(config))
        try:
            run([*compose, 'up', '-d', '--wait', 'db'])
            def sql(statement):
                return run([*compose, 'exec', '-T', 'db', 'psql', '-v', 'ON_ERROR_STOP=1',
                            '-U', 'health_test', '-d', 'health_test', '-c', statement])
            sql('CREATE SCHEMA host')
            for mode, code, with_init in [('success', 0, True), ('failure', 1, True),
                                           ('timeout', -1, True), ('success-without-init', 0, False)]:
                state = 'failed' if mode == 'failure' else 'healthy'
                delay = ', pg_sleep(60)' if mode == 'timeout' else ''
                sql("DROP VIEW IF EXISTS host.settings; CREATE VIEW host.settings AS "
                    "SELECT 'worker'::text AS key, jsonb_build_object('state', '" + state +
                    "', 'lastSeen', to_char(now() AT TIME ZONE 'UTC', "
                    "'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')) AS value FROM (SELECT 1) fixture" + delay)
                config['services']['worker']['init'] = with_init
                # Keep normal probes tolerant of cold startup on shared CI runners;
                # only the intentionally blocked query needs a shorter timeout.
                config['services']['worker']['healthcheck']['timeout'] = '2s' if mode == 'timeout' else probe_timeout
                path.write_text(json.dumps(config))
                run([*compose, 'up', '-d', '--no-deps', 'worker'])
                container = run([*compose, 'ps', '-q', 'worker'])
                if inspect(container)['HostConfig']['PidsLimit'] != 256:
                    raise RuntimeError('The fixture PID limit must remain enforced')
                results[mode] = collect(container, repetitions if with_init else 6, code, with_init)
                print(json.dumps({mode: results[mode]}), flush=True)
                run([*compose, 'rm', '-s', '-f', 'worker'])
                # Timed-out probes can leave a DB query running until its sleep ends.
                sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = 'health_test' AND pid <> pg_backend_pid()")
        finally:
            run([*compose, 'down', '--volumes', '--remove-orphans'])
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True, help='Already built local runtime image')
    parser.add_argument('--repetitions', type=int, default=20)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.repetitions < 10:
        parser.error('Use at least 10 repetitions per outcome')
    results = rehearse(args.image, args.repetitions)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(results, indent=2) + '\n')


if __name__ == '__main__':
    main()
