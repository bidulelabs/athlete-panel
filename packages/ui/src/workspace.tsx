'use client';

import { Alert } from './index';
import {
  Switch,
  Skeleton,
  Sheet,
  SheetContent,
  SheetTitle,
  SidebarMenu,
  SidebarMenuItem,
  Button,
  Input,
  Textarea,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from './index';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { GarminConnection } from '../../contracts/src/garmin-connection';
import {
  dateSchema,
  workspaceEnvelopeSchema,
  createPluginRequester,
  responseError,
  operationalValuesSchema,
  type PluginRequest,
  type WorkspaceEnvelope,
  type WorkspaceState,
} from '@athlete-panel/contracts';
export type { PluginInfo, WorkspaceEnvelope } from '@athlete-panel/contracts';
import {
  Activity,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Code2,
  HeartPulse,
  Layers,
  LogOut,
  Menu,
  Moon,
  Plug,
  Settings2,
  ShieldCheck,
  Sun,
  Terminal,
  X,
} from 'lucide-react';
import {
  addDays,
  dateLabel,
  EmptyState,
  ErrorMessage,
  Field,
  localDate,
  Modal,
  PageHeader,
  useAction,
} from './primitives';
import { operationalHealth } from './operational-status';
import { ReloadableRequestError } from './request-error';
import { resolveWeekStartsOn, startOfWeek, type WeekStartsOn } from './calendar-dates';

export interface PluginPageProps {
  data: WorkspaceState;
  refresh: () => Promise<void>;
  request: PluginRequest;
}
export interface ExtensionSelection {
  kind: string;
  id: string;
}
export interface OnboardingConnectionProps {
  variant: 'setup' | 'summary';
  connection: GarminConnection;
  workerAvailable: boolean;
  busy: boolean;
  editingKey: boolean;
  onEditingChange: (editing: boolean) => void;
  onBusy: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}
export interface WorkspaceSlot {
  id: string;
  pluginId: string;
  kind: 'calendar' | 'inspector' | 'dashboard' | 'workspace' | 'onboarding';
  title: string;
  component: ComponentType<
    PluginPageProps & { selection?: ExtensionSelection; onboarding?: OnboardingConnectionProps }
  >;
}
export interface WorkspacePage {
  path: string;
  pluginId: string;
  title: string;
  icon?: string;
  component: ComponentType<PluginPageProps>;
}
interface WorkspaceContextValue extends PluginPageProps {
  slots: WorkspaceSlot[];
  envelope: WorkspaceEnvelope;
  from: string;
  to: string;
  path: string;
  weekStartsOn: WeekStartsOn;
  setFrom: (from: string) => void;
  navigate: (path: string) => void;
}
const earliestAnchorDate = '0001-01-07';
const latestAnchorDate = '9999-12-11';
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('This page needs the Athlete Panel workspace.');
  return context;
}

function NavigationIcon({ name }: { name: string }) {
  const value = name.toLowerCase();
  const Icon = value.includes('calendar')
    ? CalendarDays
    : value.includes('plan') || value.includes('layer') || value === 'training'
      ? Layers
      : value.includes('health') || value.includes('heart') || value.includes('sleep')
        ? HeartPulse
        : value.includes('profile') || value.includes('athlete') || value.includes('setting')
          ? Settings2
          : value.includes('agent') || value.includes('spark')
            ? Terminal
            : value.includes('plug') || value.includes('garmin')
              ? Plug
              : value.includes('chart') ||
                  value.includes('volume') ||
                  value.includes('progress') ||
                  value.includes('cycling')
                ? ChartNoAxesColumnIncreasing
                : Activity;
  return <Icon size={19} strokeWidth={1.6} />;
}

export function WorkspaceApp({
  pages,
  slots = [],
  initialPath = '/calendar',
}: {
  pages: WorkspacePage[];
  slots?: WorkspaceSlot[];
  initialPath?: string;
}) {
  const [path, setPath] = useState(initialPath === '/' ? '/calendar' : initialPath);
  // Keep the selected day, so changing week starts never moves the viewed week
  // repeatedly backwards as the owner switches preferences.
  const [anchorDate, setAnchorDate] = useState(() => localDate());
  const setFrom = useCallback((date: string) => {
    if (
      dateSchema.safeParse(date).success &&
      date >= earliestAnchorDate &&
      date <= latestAnchorDate
    )
      setAnchorDate(date);
  }, []);
  const [locale, setLocale] = useState<string>();
  const [envelope, setEnvelope] = useState<WorkspaceEnvelope | null>(null);
  const weekStartsOn = resolveWeekStartsOn(envelope?.state.profile?.weekStartsOnPreference, locale);
  const from = startOfWeek(anchorDate, weekStartsOn);
  const to = addDays(from, 20);
  const [loadedRange, setLoadedRange] = useState<{ from: string; to: string } | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const initialDateResolved = useRef(false);
  useEffect(() => {
    const update = () => setLocale(navigator.language);
    update();
    window.addEventListener('languagechange', update);
    return () => window.removeEventListener('languagechange', update);
  }, []);
  useEffect(() => {
    if (!envelope || initialDateResolved.current) return;
    initialDateResolved.current = true;
    setFrom(localDate(new Date(), envelope.state.profile?.timezone));
  }, [envelope]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshSequence = useRef(0);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [theme, setTheme] = useState('dark');
  useEffect(() => {
    const saved = localStorage.getItem('athlete-panel-theme') || 'dark';
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);
  useEffect(() => {
    const pop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const refresh = useCallback(
    async (reportFailure = false) => {
      const sequence = ++refreshSequence.current;
      setRefreshing(true);
      try {
        const response = await fetch(`/api/workspace?from=${from}&to=${to}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        });
        if (response.status === 401) {
          window.location.assign(
            `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
          );
          return;
        }
        const result: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(responseError(result, 'Unable to load your workspace.'));
        if (sequence === refreshSequence.current) {
          setEnvelope(workspaceEnvelopeSchema.parse(result));
          setLoadedRange({ from, to });
          setError(null);
          setRefreshNotice(null);
        }
      } catch (err) {
        if (sequence === refreshSequence.current)
          setError(err instanceof Error ? err.message : 'Unable to load your workspace.');
        if (reportFailure) throw err;
      } finally {
        if (sequence === refreshSequence.current) setRefreshing(false);
      }
    },
    [from, to],
  );
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (path !== '/plugins') return;
    const timer = setInterval(() => {
      void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [path, refresh]);
  const request = useCallback(
    createPluginRequester(async (pluginId: string, operation: string, body: unknown) => {
      const serverDidNotAnswerMessage =
        'The server did not answer, so the change may have been saved. Use Reload saved data to check before trying again.';
      const reloadError = (message: string) =>
        new ReloadableRequestError(message, () => latestRefresh.current(true));
      const response = await fetch(
        `/api/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(operation)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        },
      ).catch(() => {
        throw reloadError(serverDidNotAnswerMessage);
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (result === null) throw reloadError(serverDidNotAnswerMessage);
        const code =
          typeof result === 'object' &&
          'error' in result &&
          typeof result.error === 'object' &&
          result.error !== null &&
          'code' in result.error
            ? result.error.code
            : null;
        if (code === 'STALE_REVISION')
          throw reloadError(
            `${responseError(result, 'This item changed.')} Use Reload saved data to review the saved version. Your draft will stay open.`,
          );
        throw new Error(responseError(result, 'The change could not be saved.'));
      }
      if (result === null) throw reloadError(serverDidNotAnswerMessage);
      // The mutation is committed even if reloading the workspace fails.
      setRefreshNotice('Your change was saved. Reloading the workspace…');
      await latestRefresh.current();
      return result;
    }),
    [],
  );
  const navigate = useCallback((nextPath: string) => {
    setPath(nextPath);
    window.history.pushState(null, '', nextPath);
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  }, []);
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('athlete-panel-theme', next);
    document.documentElement.dataset.theme = next;
  }
  const currentPage =
    pages.find((p) => p.path === path) ??
    (path === '/' ? pages.find((p) => p.path === '/calendar') : undefined);
  const profile = envelope?.state.profile;
  const navPages = pages.filter(
    (page, i, all) => all.findIndex((p) => p.path === page.path) === i && page.path !== '/plugins',
  );
  const systemPaths = ['/profile', '/athlete', '/settings', '/agent', '/agent-bridge', '/garmin'];
  const renderNav = (page: { path: string; title: string; icon?: string }) => (
    <SidebarMenuItem key={page.path}>
      <a
        href={page.path}
        className={`nav-link ${path === page.path ? 'active' : ''}`}
        onClick={(event) => {
          event.preventDefault();
          navigate(page.path);
        }}
      >
        <NavigationIcon name={page.icon ?? page.path} />
        <span>{page.title}</span>
        {page.path === '/plugins' && envelope?.plugins.some((p) => p.pending) && (
          <span className="nav-dot" />
        )}
      </a>
    </SidebarMenuItem>
  );
  const navigation = (
    <>
      <a
        href="/calendar"
        className="brand"
        onClick={(event) => {
          event.preventDefault();
          navigate('/calendar');
        }}
      >
        Athlete Panel<span>.</span>
      </a>
      <div className="instance-label">
        <span /> PERSONAL WORKSPACE
      </div>
      <nav aria-label="Main navigation">
        <div className="nav-section-label">Training</div>
        <SidebarMenu>
          {navPages.filter((p) => !systemPaths.includes(p.path)).map(renderNav)}
        </SidebarMenu>
        <div className="nav-divider" />
        <div className="nav-section-label">Workspace</div>
        <SidebarMenu>
          {renderNav({ path: '/plugins', title: 'Plugins' })}
          {navPages.filter((p) => systemPaths.includes(p.path)).map(renderNav)}
        </SidebarMenu>
      </nav>
      <div className="sidebar-bottom">
        <div className="private-marker">
          <ShieldCheck size={15} />
          <span>Your server. Your data.</span>
        </div>
        <div className="owner-row">
          <div className="avatar">{(profile?.displayName || 'A').slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>{profile?.displayName || 'Athlete'}</strong>
            <span>Private instance</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="icon-button theme-button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </Button>
        </div>
        <Button
          variant="unstyled"
          className="logout-button"
          onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.assign('/login');
          }}
        >
          <LogOut size={14} />
          Sign out
        </Button>
      </div>
    </>
  );
  return (
    <div className="workspace-shell">
      <div className="mobile-bar">
        <Button
          variant="ghost"
          size="icon"
          className="icon-button"
          ref={navigationTrigger}
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
        >
          <Menu size={21} />
        </Button>
        <span className="brand">
          Athlete Panel<span>.</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="icon-button"
          onClick={toggleTheme}
          aria-label="Change color theme"
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </Button>
      </div>
      {isMobile ? (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="navigation-sheet"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              navigationTrigger.current?.focus();
            }}
            showCloseButton={false}
            aria-describedby={undefined}
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              className="navigation-close"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            >
              <X size={19} />
            </Button>
            {navigation}
          </SheetContent>
        </Sheet>
      ) : (
        <aside className="sidebar">{navigation}</aside>
      )}

      <main className="workspace-main">
        {error && (
          <div className="page-error">
            {refreshNotice && (
              <p role="status">
                Your change was saved, but the workspace could not refresh. Use Try again to reload
                it.
              </p>
            )}
            <ErrorMessage error={error} />
            {loadedRange && (
              <p className="muted-text">
                Showing the last loaded dates: {dateLabel(loadedRange.from)} —{' '}
                {dateLabel(loadedRange.to)}.
              </p>
            )}
            <Button
              variant="link"
              className="text-button"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              Try again
            </Button>
          </div>
        )}
        {!envelope ? (
          <div className="workspace-loading" role="status">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-24 w-full" />
            <p>Opening your workspace…</p>
          </div>
        ) : (
          <WorkspaceContext.Provider
            value={{
              data: envelope.state,
              envelope,
              refresh,
              request,
              from: loadedRange?.from ?? from,
              to: loadedRange?.to ?? to,
              path,
              weekStartsOn,
              setFrom,
              navigate,
              slots,
            }}
          >
            <div className="page-content" key={path}>
              {path === '/plugins' ? (
                <PluginsPage />
              ) : currentPage ? (
                <currentPage.component data={envelope.state} refresh={refresh} request={request} />
              ) : (
                <EmptyState
                  title="This workspace is not available"
                  action={
                    <Button
                      variant="default"
                      className="button primary"
                      onClick={() => navigate('/plugins')}
                    >
                      Manage plugins
                    </Button>
                  }
                >
                  Enable the plugin to make this page available.
                </EmptyState>
              )}
            </div>
            <ExtensionSlot kind="workspace" />
          </WorkspaceContext.Provider>
        )}
      </main>
    </div>
  );
}

export function DateNavigation({ weeks = 3 }: { weeks?: number }) {
  const { data, from, setFrom } = useWorkspace();
  return (
    <div className="date-navigation">
      <Button
        variant="ghost"
        size="icon"
        className="icon-button"
        aria-label="Previous week"
        onClick={() => setFrom(addDays(from, -7))}
      >
        <ChevronLeft size={17} />
      </Button>
      <Button
        variant="ghost"
        className="button subtle"
        onClick={() => setFrom(localDate(new Date(), data.profile?.timezone))}
      >
        Today
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="icon-button"
        aria-label="Next week"
        onClick={() => setFrom(addDays(from, 7))}
      >
        <ChevronRight size={17} />
      </Button>
      <label className="date-jump">
        <CalendarDays size={15} />
        <span>
          {dateLabel(from)} — {dateLabel(addDays(from, weeks * 7 - 1))}
        </span>
        <Input
          type="date"
          value={from}
          aria-label="Go to date"
          onChange={(event) => event.target.value && setFrom(event.target.value)}
        />
      </label>
    </div>
  );
}

function PluginsPage() {
  const { envelope, request } = useWorkspace();
  const [search, setSearch] = useState('');
  const [handoff, setHandoff] = useState(false);
  const [idea, setIdea] = useState('Compare my cycling volume with sleep.');
  const [copied, setCopied] = useState(false);
  const action = useAction();
  const plugins = envelope.plugins.filter((p) =>
    `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE, EXTENDED"
        title="Plugins"
        description="Choose the capabilities in your training workspace."
        actions={
          <Button variant="default" className="button primary" onClick={() => setHandoff(true)}>
            <Code2 size={17} />
            Create with agent
          </Button>
        }
      />
      <div className="section-toolbar">
        <div className="section-tab">
          Installed <span>{envelope.plugins.length}</span>
        </div>
        <Input
          className="search-input"
          placeholder="Find a plugin"
          aria-label="Find a plugin"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <ErrorMessage error={action.error} />
      <div className="plugin-table">
        <div className="plugin-table-header">
          <span>Plugin</span>
          <span>Status</span>
          <span>Version</span>
          <span />
        </div>
        {plugins.map((plugin) => (
          <div className="plugin-row" key={plugin.id}>
            <div className="plugin-name">
              <span className="plugin-symbol">
                <NavigationIcon name={plugin.id} />
              </span>
              <div>
                <strong>{plugin.name}</strong>
                <p>{plugin.description}</p>
                {plugin.dependencies.length > 0 && (
                  <small>Requires {plugin.dependencies.join(', ')}</small>
                )}
              </div>
            </div>
            <div className={`plugin-status ${plugin.pending ? 'pending' : ''}`}>
              <span className={`status-dot ${plugin.enabled ? '' : 'muted'}`} />
              {plugin.pending ? 'Deployment pending' : plugin.enabled ? 'Enabled' : 'Disabled'}
            </div>
            <span className="version-label">{plugin.version}</span>
            <Switch
              checked={plugin.desiredEnabled}
              aria-label={`${plugin.desiredEnabled ? 'Disable' : 'Enable'} ${plugin.name}`}
              disabled={action.busy || plugin.required}
              title={plugin.required ? 'Required foundation plugin' : undefined}
              onCheckedChange={(enabled) =>
                action.run(() => request('host', 'plugins', { id: plugin.id, enabled }))
              }
            />
          </div>
        ))}
      </div>
      {plugins.length === 0 && (
        <EmptyState title="No matching plugins">Try another search.</EmptyState>
      )}
      <div className="info-line">
        <ShieldCheck size={16} />
        <p>
          Disabling a plugin keeps its data. Changes require a reviewed composition, rebuild and
          deployment. Restarting alone does not activate them.
        </p>
      </div>
      <OperationalStatus />
      <Modal
        open={handoff}
        onClose={() => setHandoff(false)}
        title="Create a plugin"
        description="Give your coding agent a focused request. Preview the result before activation."
      >
        <div className="dialog-body">
          <Field label="What would you like to add?">
            <Textarea rows={4} value={idea} onChange={(event) => setIdea(event.target.value)} />
          </Field>
          <div className="agent-handoff-note">
            <Terminal size={21} />
            <div>
              <strong>Use your own agent</strong>
              <p>
                Open this project in Codex, Claude Code, or a compatible coding tool. The feature
                keeps working after your agent exits.
              </p>
            </div>
          </div>
          <ErrorMessage error={action.error} />
          <Button
            variant="default"
            className="button primary full-width"
            disabled={!idea.trim()}
            onClick={() =>
              action.run(async () => {
                await navigator.clipboard.writeText(
                  `Read AGENTS.md and the canonical plugin-development skill linked there. Create a personal feature plugin for Athlete Panel: ${idea.trim()} Use only documented public extension points and shared contracts. Use synthetic data for verification. Preview the plugin, report checks and provide activation and rollback instructions. Do not access server or Garmin secrets.`,
                );
                setCopied(true);
              })
            }
          >
            {copied ? <Check size={17} /> : <Clipboard size={17} />}
            {copied ? 'Request copied' : 'Copy agent request'}
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section-block">
      <div className="section-heading">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function OnboardingConnectionSlot(props: OnboardingConnectionProps) {
  const { slots, data, refresh, request } = useWorkspace();
  return (
    <>
      {slots
        .filter((slot) => slot.kind === 'onboarding')
        .map((slot) => (
          <slot.component
            key={`${slot.pluginId}:${slot.id}`}
            data={data}
            refresh={refresh}
            request={request}
            onboarding={props}
          />
        ))}
    </>
  );
}

export function ExtensionSlot({
  kind,
  selection,
}: {
  kind: WorkspaceSlot['kind'];
  selection?: ExtensionSelection;
}) {
  const { slots, data, refresh, request } = useWorkspace();
  return (
    <>
      {slots
        .filter((slot) => slot.kind === kind)
        .map((slot) =>
          kind === 'workspace' ? (
            <slot.component
              key={`${slot.pluginId}:${slot.id}`}
              data={data}
              refresh={refresh}
              request={request}
            />
          ) : (
            <section
              className={`extension-slot extension-slot-${kind}`}
              aria-label={slot.title}
              key={`${slot.pluginId}:${slot.id}`}
            >
              <h3>{slot.title}</h3>
              <slot.component
                data={data}
                refresh={refresh}
                request={request}
                selection={selection}
              />
            </section>
          ),
        )}
    </>
  );
}

export function OperationalStatus() {
  const { envelope } = useWorkspace();
  const values = operationalValuesSchema.parse(
    Object.fromEntries((envelope.operational ?? []).map((row) => [row.key, row.value])),
  );
  const health = operationalHealth(values);
  const migrations: Array<{ pluginId: string; name: string; appliedAt: string }> = Array.isArray(
    values.schema,
  )
    ? values.schema
    : [];
  const timestamp = (value: unknown) =>
    typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString('en-GB')
      : 'Not recorded';
  return (
    <section className="section-block">
      <div className="section-heading">
        <h2>Instance status</h2>
        <span className="muted-text">Visible only to the owner</span>
      </div>
      <dl className="operational-status">
        <div>
          <dt>Background worker</dt>
          <dd role={health.workerWarning ? 'status' : undefined}>{health.worker}</dd>
          <dd>{timestamp(values.worker?.lastSeen)}</dd>
        </div>
        <div>
          <dt>Backup protection</dt>
          <dd role={health.backupWarning ? 'status' : undefined}>{health.backup}</dd>
          <dd>Last success: {timestamp(values.lastBackup?.completedAt)}</dd>
        </div>
        <div>
          <dt>Database schema</dt>
          <dd>{migrations.length ? `${migrations.length} applied migrations` : 'Not recorded'}</dd>
        </div>
      </dl>
      {health.workerWarning && (
        <Alert role="status" className="callout">
          The worker has stopped or failed. For local use, check the terminal running pnpm run
          local. For hosted use, inspect docker compose logs --tail=100 worker and restart it after
          correcting the reported cause. Automatic imports need a healthy worker.
        </Alert>
      )}
      {health.backupWarning && (
        <Alert role="status" className="callout">
          Enable the backup service and check its logs, separate encryption key and off-host
          destination. A successful backup still needs a restore rehearsal.
        </Alert>
      )}
      {values.backupSchedule?.nextRunAt && (
        <p className="muted-text">
          Next scheduled backup: {timestamp(values.backupSchedule.nextRunAt)}
        </p>
      )}
      {migrations.length > 0 && (
        <details className="schema-details">
          <summary>View applied migrations</summary>
          <div className="coverage-scroll">
            <Table className="coverage-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Plugin</TableHead>
                  <TableHead>Migration</TableHead>
                  <TableHead>Applied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {migrations.map((row) => (
                  <TableRow key={`${row.pluginId}:${row.name}`}>
                    <TableCell>{row.pluginId}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{timestamp(row.appliedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      )}
    </section>
  );
}
