#!/usr/bin/env python3
"""Exercise the real hosted controller with disposable projects, loopback TLS and synthetic storage."""
import argparse
import http.client
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import ssl
import tempfile
import tarfile
import uuid
from hosted import Hosted, OperationError, ROOT, write_json


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); return sock.getsockname()[1]


class Browser:
    def __init__(self, instance):
        self.instance = instance; self.cookie = ''

    def request(self, path, data=None, expected=200):
        context = ssl.create_default_context(cafile=str(self.instance.state / 'test-ca.crt'))
        connection = http.client.HTTPSConnection('localhost', self.instance.test['port'], context=context, timeout=20)
        try:
            connection.request('POST' if data is not None else 'GET', path, json.dumps(data) if data is not None else None,
                               {'Content-Type':'application/json', 'Origin':self.instance.origin(), 'Cookie':self.cookie})
            response = connection.getresponse(); body = response.read()
            if response.status != expected: raise RuntimeError(f'Synthetic HTTP assertion failed: {path} returned {response.status}, expected {expected}.')
            cookie = response.getheader('Set-Cookie')
            if cookie:
                if 'Secure' not in cookie or 'HttpOnly' not in cookie: raise RuntimeError('Missing secure cookie flags.')
                self.cookie = cookie.split(';')[0]
            return json.loads(body)
        finally: connection.close()


def copy_candidate(destination):
    # Explicit source roots, never .env, state, exports or the owner's database.
    roots = ['apps','packages','plugins','personal-plugins','instance','scripts','tests','docs','.agents','.claude','.github',
             'package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json', 'tsconfig.strict.json', 'eslint.config.mjs', '.prettierrc.json', '.prettierignore', '.git-blame-ignore-revs','vitest.config.ts','playwright.config.ts',
             'Dockerfile','compose.yml','compose.local.yml','compose.test.yml','Caddyfile','.dockerignore','.gitignore','.env.example',
             'AGENTS.md','README.md','PRODUCT.md','DESIGN.md','.impeccable/design.json','LICENSE','SECURITY.md','CONTRIBUTING.md']
    excluded = shutil.ignore_patterns('node_modules','.next','dist','.runtime','.env','.env.*','.secrets','private-exports','context.json','proposal.json','__pycache__','*.pyc','*.fgr','*.dump','*.key','*.pem')
    destination.mkdir(mode=0o700)
    for name in roots:
        source = ROOT / name
        if source.is_dir(): shutil.copytree(source, destination/name, ignore=excluded)
        else:
            (destination/name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination/name)


def main():
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--image',help='Already built base image; retained after rehearsal')
    parser.add_argument('--registry',action='store_true',help='Exercise image pulls and the source-free bundle against a disposable loopback registry')
    args=parser.parse_args()
    if args.registry and not args.image: parser.error('--registry requires --image')
    stage = Path(tempfile.mkdtemp(prefix='athlete-panel-hosted-rehearsal-'));stage.chmod(0o700)
    backup = stage/'remote-fixture';backup.mkdir(mode=0o700)
    instances=[]; images=set(); password='synthetic-'+secrets.token_hex(16); registry=None; tags=[]
    try:
        instance=Hosted(stage/'operator',test={'port':free_port()});instances.append(instance)
        remote=None
        if args.registry:
            registry='athlete-panel-registry-test-'+secrets.token_hex(5); endpoint='localhost:'+str(free_port())
            instance.run(['docker','run','-d','--name',registry,'-p','127.0.0.1:'+endpoint.split(':')[1]+':5000','registry:2'])
            def publish(image, version):
                tag=endpoint+'/athlete-panel:'+version;tags.append(tag)
                instance.run(['docker','tag',image,tag]);instance.run(['docker','push',tag]);return tag
            remote=publish(args.image,'v1')
            digest=json.loads(instance.run(['docker','image','inspect',remote]).stdout)[0]['RepoDigests']
            digest=next(value for value in digest if value.startswith(endpoint+'/'))
            spec=importlib.util.spec_from_file_location('package_release',ROOT/'scripts/package-release.py');packager=importlib.util.module_from_spec(spec);spec.loader.exec_module(packager)
            bundle=stage/'release.tgz';packager.package_release(digest,bundle)
            extracted=stage/'bundle';extracted.mkdir()
            with tarfile.open(bundle) as archive: archive.extractall(extracted,filter='data')
            descriptor=json.loads((extracted/'release.json').read_text());assert not (extracted/'Dockerfile').exists()
            spec=importlib.util.spec_from_file_location('bundled_hosted',extracted/'scripts/hosted.py');bundled=importlib.util.module_from_spec(spec);spec.loader.exec_module(bundled)
            instance=bundled.Hosted(stage/'operator',test={'port':instance.test['port']});instances[-1]=instance
            # Both modules use the same exception contract for the test assertions below.
            bundled.OperationError=OperationError
            remote=descriptor['image']
        # A killed configuration container can leave PID 1 from the old standalone helper.
        # Hosted coordination uses its host flock and exclusive secret writes, not container PIDs.
        (instance.state/'.runtime').mkdir(mode=0o700)
        stale=instance.state/'.runtime/local-command.lock';stale.write_text('1');stale.chmod(0o600)
        instance.install(None if remote else ROOT,'training.example.com',backup,password=password,image=None if remote else args.image,image_ref=remote)
        base=instance.record['active'];images.add(base['image'])
        configuration=(instance.state/'.env').read_bytes();key=(instance.state/'.secrets/backup-key').read_bytes()
        try:instance.install(ROOT,'training.example.com',backup,password='must-never-replace')
        except OperationError:pass
        else:raise RuntimeError('Repeated installation replaced existing state.')
        assert (instance.state/'.env').read_bytes()==configuration and (instance.state/'.secrets/backup-key').read_bytes()==key
        browser=Browser(instance);browser.request('/api/auth/login',{'password':password})
        workout=str(uuid.uuid4())
        def create(identifier):
            browser.request('/api/plugins/training/mutate',{'idempotencyKey':str(uuid.uuid4()),'commands':[{'action':'workout.create','values':{'id':identifier,'title':'Synthetic hosted ride','sport':'cycling','schedule':{'kind':'independent','date':'2026-10-25'},'durationSeconds':3600}}]})
        def persisted():
            state=browser.request('/api/workspace?from=2026-10-19&to=2026-10-25')['state']
            assert any(row['id']==workout for row in state['workouts'])
        def sql(query,release=None):
            release=release or instance.record['active']
            return instance.compose(release,['exec','-T','db','psql','-U','athlete_panel','-d',release['database'],'-Atc',query]).stdout.strip()
        create(workout);persisted()
        # Encrypted fixture confirms separately retained application keys survive recovery.
        instance.compose(base,['run','--rm','--no-deps','-T','web','node','--import','tsx','--input-type=module','-e',
            "import {connection,closeDatabase} from './packages/host/src/db.ts'; import {encrypt} from './packages/host/src/crypto.ts'; const s=connection(); await s`insert into host.settings(key,value) values('hosted-rehearsal',${s.json(encrypt('synthetic-credential'))})`; await closeDatabase();"])
        instance.compose(base,['restart','db','web','worker']);instance.ready(base);persisted()
        initial=instance.backup();archive=backup/initial['file']
        print('PASS: generated setup, secure login, persistence, verified backup and preserved credentials.',flush=True)
        if remote:
            assert base['registryRef']==remote and base['origin']['kind']=='registry'
            assert instance.verify_archive(archive)['release']['registryRef']==remote
            # A legacy/custom build cannot silently switch to a stock publisher.
            original_origin=base['origin'];base['origin']={'kind':'source'};instance.save()
            try:
                try:instance.upgrade(image_ref=remote)
                except OperationError as error:assert 'custom/older' in str(error)
                else:raise RuntimeError('Custom image was silently replaced.')
                assert instance.pending['phase']=='validate-upgrade-source'
                assert sql("select value from host.settings where key='maintenance'")=='false'
                instance.cancel()
            finally:base['origin']=original_origin;instance.save()
            # Installed custom-plugin identity, without new SQL, exercises the removal guard.
            original_composition=sql("select value from host.settings where key='composition'")
            sql("update host.settings set value=value || '[{\"id\":\"synthetic-owner-plugin\",\"enabled\":true}]'::jsonb where key='composition'")
            try:
                try:instance.upgrade(image_ref=remote)
                except OperationError as error:assert 'removes or disables' in str(error)
                else:raise RuntimeError('Installed plugin silently removed.')
                assert sql("select value from host.settings where key='maintenance'")=='false';instance.cancel()
            finally:sql("update host.settings set value='"+original_composition.replace("'","''")+"'::jsonb where key='composition'")
            print('PASS: source-free bundle, immutable pull identity, authenticated image backup and custom/plugin guards before downtime.',flush=True)

        # Missing mount identity must fail before creating a new archive.
        instance.compose(base,['--profile','backup','stop','backup'])
        marker=backup/'.athlete-panel-storage-id';held=backup/'.held-identity';marker.rename(held)
        before=set(backup.glob('*.fgr'))
        try:
            try:instance.backup()
            except OperationError:pass
            else:raise RuntimeError('Missing storage identity was accepted.')
            assert set(backup.glob('*.fgr'))==before
        finally:held.rename(marker)

        candidate=stage/'candidate';copy_candidate(candidate)
        manifest=candidate/'plugins/athlete/manifest.json';metadata=json.loads(manifest.read_text())
        metadata['migrations'].append('migrations/990-hosted-rehearsal.sql');manifest.write_text(json.dumps(metadata,indent=2))
        (candidate/'plugins/athlete/migrations/990-hosted-rehearsal.sql').write_text('create table athlete.hosted_rehearsal (id integer primary key); insert into athlete.hosted_rehearsal values(1);\n')
        # A real owner extension travels with source/image, composition and recovery snapshots.
        custom=candidate/'personal-plugins/owner-example';custom.mkdir()
        custom_manifest=json.loads((candidate/'personal-plugins/cycling-sleep/manifest.json').read_text())
        custom_manifest.update(id='owner-example',name='Owner example',routes=[{'path':'/owner-example','title':'Owner example','icon':'ChartNoAxesCombined'}])
        (custom/'manifest.json').write_text(json.dumps(custom_manifest));(custom/'client.tsx').write_text("'use client';\nexport default function OwnerExample(){return <p>Synthetic owner extension</p>;}\n")
        composition=json.loads((candidate/'instance/composition.json').read_text());composition['plugins'].append({'path':'personal-plugins/owner-example','version':'1.0.0','enabled':True})
        (candidate/'instance/composition.json').write_text(json.dumps(composition))
        candidate_remote=None
        if remote:
            tag=instance.record['project']+':candidate';instance.run(['docker','build','-t',tag,str(candidate)],timeout=3600)
            candidate_remote=publish(tag,'v2')
        console=instance.console;interrupted=False
        def interrupted_console(release,service,script,*arguments,**kwargs):
            nonlocal interrupted
            result=console(release,service,script,*arguments,**kwargs)
            if script=='scripts/migrate.ts' and not interrupted:
                interrupted=True;raise OperationError('Synthetic interruption immediately after migration commit.')
            return result
        instance.console=interrupted_console
        try:
            try:instance.upgrade(None if candidate_remote else candidate,image_ref=candidate_remote)
            except OperationError:
                if not interrupted:raise
            else:raise RuntimeError('Expected injected interruption.')
        finally:instance.console=console
        assert instance.pending['phase']=='apply-migrations'
        assert sql("select value from host.settings where key='maintenance'")=='true'
        assert sql('select count(*) from athlete.hosted_rehearsal')=='1'
        instance.resume();upgraded=instance.record['active'];images.add(upgraded['image'])
        assert sql('select count(*) from athlete.hosted_rehearsal')=='1';persisted()
        assert any(plugin['id']=='owner-example' for plugin in upgraded['metadata']['plugins'])
        custom_archive=backup/instance.backup()['file']
        assert instance.verify_archive(custom_archive)['release']['sourceDigest']==upgraded['metadata']['sourceDigest']
        result=instance.compose(base,['run','--rm','--no-deps','-T','web','node','--import','tsx','scripts/operations.ts','verify-schema'],check=False)
        assert result.returncode!=0
        print('PASS: real forward migration, interruption after commit, safe resume, old-artifact rejection and preserved records.',flush=True)

        # A wrong backup key must fail before a recovery database or service stop.
        keyfile=instance.state/'.secrets/backup-key';saved=keyfile.read_bytes()
        keyfile.write_bytes(b'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
        try:
            try:instance.verify_archive(archive)
            except OperationError:pass
            else:raise RuntimeError('Wrong key accepted.')
        finally:keyfile.write_bytes(saved)
        instance.recover(archive,image=args.image or base['image'],rebuild_source=not args.registry)
        recovered=instance.record['active'];images.add(recovered['image'])
        assert recovered['database']!=upgraded['database']
        assert sql("select to_regclass('athlete.hosted_rehearsal') is null")=='t'
        assert sql('select count(*) from athlete.hosted_rehearsal',upgraded)=='1'
        browser.request('/api/workspace?from=2026-10-19&to=2026-10-25',expected=401)
        browser.request('/api/auth/login',{'password':password});persisted();create(str(uuid.uuid4()))
        assert instance.backup()['verified']
        print('PASS: '+('exact-image recovery' if args.registry else 'matched-source rebuild')+' and restored app login/save/backup; previous database retained, sessions revoked.',flush=True)

        # Simulate another server: new project/volume and operator directory, same protected keys/archive.
        instance.compose(recovered,['--profile','backup','stop','backup'])
        replacement=(bundled.Hosted if args.registry else Hosted)(stage/'replacement',test={'port':free_port()});instances.append(replacement)
        shutil.copyfile(instance.state/'.env',replacement.state/'.env');(replacement.state/'.env').chmod(0o600)
        shutil.copytree(instance.state/'.secrets',replacement.state/'.secrets')
        replacement.record={**instance.record,'project':'athlete-panel-hosted-'+secrets.token_hex(5)};replacement.save()
        if args.registry:
            original_run=replacement.run;pulled=[]
            def cold_run(arguments,**kwargs):
                if arguments[:2]==['docker','build']:raise RuntimeError('Image recovery unexpectedly built source.')
                if arguments[:3]==['docker','image','inspect'] and arguments[-1] in [base['image'],upgraded['image']]:
                    import subprocess
                    return subprocess.CompletedProcess(arguments,1,'','synthetic missing local image')
                if arguments[:2]==['docker','pull']:pulled.append(arguments[-1])
                return original_run(arguments,**kwargs)
            replacement.run=cold_run
        replacement.recover(custom_archive if args.registry else archive,image=None if args.registry else args.image or base['image']);images.add(replacement.record['active']['image'])
        if args.registry:
            assert remote in pulled and upgraded['registryRef'] in pulled
            assert any(plugin['id']=='owner-example' for plugin in replacement.record['active']['metadata']['plugins'])
            restored_release=replacement.record['active']
            assert replacement.compose(restored_release,['exec','-T','db','psql','-U','athlete_panel','-d',restored_release['database'],'-Atc','select count(*) from athlete.hosted_rehearsal']).stdout.strip()=='1'
        second=Browser(replacement);second.request('/api/auth/login',{'password':password})
        assert any(row['id']==workout for row in second.request('/api/workspace?from=2026-10-19&to=2026-10-25')['state']['workouts'])
        result=replacement.compose(replacement.record['active'],['run','--rm','--no-deps','-T','web','node','--import','tsx','--input-type=module','-e',
            "import {connection,closeDatabase} from './packages/host/src/db.ts'; import {decrypt} from './packages/host/src/crypto.ts'; const s=connection(); const [r]=await s`select value from host.settings where key='hosted-rehearsal'`; if(decrypt(r.value)!=='synthetic-credential')process.exitCode=1; await closeDatabase();"])
        assert result.returncode==0 and replacement.backup()['verified']
        print('PASS: empty replacement cluster, recovered keys/source, HTTPS login, encrypted fixture and a new backup.',flush=True)
        print('LIMIT: remote mount checks use explicit synthetic storage. Real off-host transport and public DNS/CA renewal still require operator rehearsal.',flush=True)
    finally:
        for instance in reversed(instances):
            if not instance.record:continue
            pending=instance.pending or {}
            for key in ['candidate','tools','previous']:
                if pending.get(key):images.add(pending[key]['image'])
            release=instance.record.get('active') or pending.get('candidate') or pending.get('tools')
            if release:
                try:instance.compose(release,['--profile','backup','down','--volumes','--remove-orphans'],check=False)
                except (OperationError,OSError):pass
            # Remove only tags created with this rehearsal's unique project prefix.
            tags=instance.run(['docker','image','ls','--filter','reference='+instance.record['project']+':*','--format','{{.Repository}}:{{.Tag}}'],check=False).stdout.splitlines()
            for tag in tags:instance.run(['docker','image','rm',tag],check=False)
        if registry and instances:
            instances[0].run(['docker','rm','-f','-v',registry],check=False)
            # Registry tags are scoped to this disposable loopback endpoint.
            for tag in instances[0].run(['docker','image','ls','--filter','reference='+endpoint+'/*','--format','{{.Repository}}:{{.Tag}}'],check=False).stdout.splitlines():
                instances[0].run(['docker','image','rm',tag],check=False)
        shutil.rmtree(stage)
        print('Disposable hosted services, volumes and state removed.',flush=True)


if __name__=='__main__':main()
