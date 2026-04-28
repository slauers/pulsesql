import { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeftRight, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { createDefaultConnectionForm, ENGINE_DEFINITIONS } from './connection-engines';
import { CONNECTION_COLOR_PALETTE, ConnectionConfig, DatabaseEngine, OracleConnectionType, PostgresSslMode, SshAuthMethod, hexToRgba, useConnectionsStore } from '../../store/connections';
import { useUiPreferencesStore } from '../../store/uiPreferences';
import { translate } from '../../i18n';
import AppSelect from '../../components/ui/AppSelect';
import JdkSetupBanner from './JdkSetupBanner';
import PulseLoader from '../../components/ui/PulseLoader';

type DefaultableField = 'name' | 'host' | 'port' | 'database' | 'user';

const ORACLE_DRIVER_PROPERTIES_PLACEHOLDER = [
  'oracle.net.disableOob=true',
  'oracle.net.CONNECT_TIMEOUT=10000',
  'oracle.jdbc.ReadTimeout=30000',
  'oracle.jdbc.defaultConnectionValidation=NETWORK',
  'defaultRowPrefetch=10',
].join('\n');

export default function ConnectionForm({
  onClose,
  initialConnection,
}: {
  onClose: () => void;
  initialConnection?: ConnectionConfig | null;
}) {
  const addConnection = useConnectionsStore((state) => state.addConnection);
  const updateConnection = useConnectionsStore((state) => state.updateConnection);
  const locale = useUiPreferencesStore((state) => state.locale);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [formData, setFormData] = useState<Partial<ConnectionConfig>>(initialConnection ?? createDefaultConnectionForm());
  const [showMainPassword, setShowMainPassword] = useState(false);
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');
  const [saveAsNewToast, setSaveAsNewToast] = useState<string | null>(null);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [connectionString, setConnectionString] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const [touchedDefaultFields, setTouchedDefaultFields] = useState<Record<DefaultableField, boolean>>(() =>
    initialConnection
      ? {
          name: Boolean(initialConnection.name),
          host: Boolean(initialConnection.host),
          port: initialConnection.port !== undefined,
          database: Boolean(initialConnection.database),
          user: Boolean(initialConnection.user),
        }
      : {
          name: false,
          host: false,
          port: false,
          database: false,
          user: false,
        },
  );

  const currentEngine = formData.engine ?? 'postgres';
  const engineDefinition = ENGINE_DEFINITIONS[currentEngine];
  const sshEnabled = Boolean(formData.ssh?.enabled);
  const sshAuthMethod = formData.ssh?.authMethod ?? 'password';
  const formConnectionColor = formData.color ?? '#47C4E8';

  const updateField = <K extends keyof ConnectionConfig>(field: K, value: ConnectionConfig[K]) => {
    if (field === 'name' || field === 'host' || field === 'port' || field === 'database' || field === 'user') {
      setTouchedDefaultFields((current) => ({ ...current, [field]: true }));
    }
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const updateSshField = (field: string, value: string | number | boolean | undefined) => {
    setFormData((current) => ({
      ...current,
      ssh: {
        enabled: current.ssh?.enabled ?? false,
        host: current.ssh?.host ?? '',
        port: current.ssh?.port ?? 22,
        user: current.ssh?.user ?? '',
        authMethod: current.ssh?.authMethod ?? 'password',
        password: current.ssh?.password ?? '',
        privateKeyPath: current.ssh?.privateKeyPath ?? '',
        passphrase: current.ssh?.passphrase ?? '',
        ...current.ssh,
        [field]: value,
      },
    }));
  };

  const handleEngineChange = (engine: DatabaseEngine) => {
    const defaults = createDefaultConnectionForm(engine);
    setFormData((current) => ({
      ...current,
      name: touchedDefaultFields.name ? current.name : defaults.name,
      engine,
      host: touchedDefaultFields.host ? current.host : defaults.host,
      port: touchedDefaultFields.port ? current.port : defaults.port,
      database: touchedDefaultFields.database ? current.database : defaults.database,
      user: touchedDefaultFields.user ? current.user : defaults.user,
      connectTimeoutSeconds: current.connectTimeoutSeconds ?? defaults.connectTimeoutSeconds,
      autoReconnect: current.autoReconnect ?? defaults.autoReconnect,
      postgresSslMode: engine === 'postgres' ? current.postgresSslMode ?? defaults.postgresSslMode : undefined,
      oracleConnectionType: engine === 'oracle' ? current.oracleConnectionType ?? defaults.oracleConnectionType : undefined,
      oracleDriverProperties: engine === 'oracle'
        ? current.oracleDriverProperties ?? defaults.oracleDriverProperties
        : undefined,
      ssh: current.ssh ?? defaults.ssh,
    }));
  };

  const handleSshAuthMethodChange = (authMethod: SshAuthMethod) => {
    updateSshField('authMethod', authMethod);
    if (authMethod === 'password') {
      updateSshField('privateKeyPath', '');
      updateSshField('passphrase', '');
    } else {
      updateSshField('password', '');
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const payload = buildPayload(formData);
    if (!payload) {
      return;
    }

    if (initialConnection) {
      updateConnection(payload);
    } else {
      addConnection(payload);
    }

    onClose();
  };

  const handleTestConnection = async () => {
    const payload = buildPayload(formData);
    if (!payload) {
      setTestState('error');
      setTestMessage('Preencha os campos obrigatorios antes de testar a conexao.');
      return;
    }

    setTestState('testing');
    setTestMessage('');

    try {
      const result = await invoke<string>('test_connection', { config: payload });
      setTestState('success');
      setTestMessage(result);
    } catch (error) {
      setTestState('error');
      setTestMessage(extractErrorMessage(error));
    }
  };

  const handleImportConnectionString = () => {
    const imported = parseConnectionString(connectionString);
    if (!imported) {
      setImportMessage('Connection string invalida ou ainda nao suportada.');
      return;
    }

    setFormData((current) => ({
      ...current,
      ...imported,
      id: current.id,
      name: current.name && current.name.trim().length > 0 ? current.name : imported.name,
      ssh: current.ssh ?? imported.ssh,
    }));
    setTouchedDefaultFields({
      name: Boolean(currentNameOrImportedName(formData.name, imported.name)),
      host: Boolean(imported.host),
      port: imported.port !== undefined,
      database: Boolean(imported.database),
      user: Boolean(imported.user),
    });
    setImportMessage('Connection string importada com sucesso.');
    setTestState('idle');
    setTestMessage('');
  };

  const cc = formConnectionColor;
  const ccBorder = hexToRgba(cc, 0.3);
  const ccBg = hexToRgba(cc, 0.07);
  const ccBgHover = hexToRgba(cc, 0.14);

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Fixed header ── */}
      <div className="shrink-0 border-b border-border/60 px-5 pt-5 pb-0">
        <div className="flex items-start justify-between gap-4 pb-4">
          <div>
            <h2 className="text-xl font-bold text-text">
              {initialConnection ? 'Edit Connection' : 'New Connection'}
            </h2>
            {initialConnection ? (
              <p className="mt-0.5 text-xs text-muted/60">
                {buildConnectionSubtitle(initialConnection)}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowImportPanel((current) => !current)}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
            >
              Import from connection string
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border p-1.5 text-muted hover:bg-border/30 hover:text-text"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Metadata strip */}
        {initialConnection ? (
          <div className="mb-0 grid grid-cols-4 divide-x divide-border/40 border-t border-border/40">
            <MetaItem label={t('metaCreated')} value={initialConnection.createdAt ? formatMetaDate(initialConnection.createdAt) : t('never')} />
            <MetaItem label={t('metaLastConnected')} value={initialConnection.lastConnectedAt ? formatMetaRelative(initialConnection.lastConnectedAt) : t('never')} />
            <MetaItem
              label={t('metaAvgLatency')}
              value={initialConnection.avgLatencyMs != null ? `${initialConnection.avgLatencyMs}ms` : '—'}
            />
            <MetaItem
              label={t('metaEngine')}
              value={initialConnection.engineVersion ?? (initialConnection.engine === 'oracle' ? 'Oracle' : initialConnection.engine === 'mysql' ? 'MySQL' : 'PostgreSQL')}
            />
          </div>
        ) : null}
      </div>

      {/* ── Scrollable body ── */}
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <div className="mx-auto max-w-3xl space-y-3">

        {showImportPanel ? (
          <div className="rounded-lg border border-border/70 bg-surface/65 p-3 shadow-[0_16px_48px_rgba(0,0,0,0.28)]">
            <div className="mb-2 text-sm font-medium text-text">Import Connection String</div>
            <textarea
              value={connectionString}
              onChange={(event) => setConnectionString(event.target.value)}
              placeholder="postgresql://postgres:password@host:5432/postgres?sslmode=require"
              className="min-h-16 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-text outline-none transition-colors focus:border-primary"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="text-xs text-muted">
                Suporta `postgres://` e `postgresql://`. Para Supabase, use `sslmode=require`.
              </div>
              <button
                type="button"
                onClick={handleImportConnectionString}
                className="rounded border border-border px-3 py-2 text-sm text-text hover:bg-border/30"
              >
                Import
              </button>
            </div>
            {importMessage ? <div className="mt-3 text-xs text-primary/80">{importMessage}</div> : null}
          </div>
        ) : null}

      <form id="connection-form" onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="block text-sm text-muted mb-1">Connection Name</label>
            <div className="flex items-center gap-2">
              <input
                value={formData.name}
                onChange={(event) => updateField('name', event.target.value)}
                className="flex-1 rounded border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                placeholder="Production DB"
                required
              />
              <div className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => colorInputRef.current?.click()}
                  className="flex h-8 w-8 items-center justify-center rounded-md border-2 border-border transition-transform hover:scale-105"
                  style={{ borderColor: formConnectionColor, background: `${formConnectionColor}22` }}
                  title="Connection color"
                >
                  <div className="w-3.5 h-3.5 rounded-sm" style={{ background: formConnectionColor }} />
                </button>
                <input
                  ref={colorInputRef}
                  type="color"
                  value={formConnectionColor}
                  onChange={(e) => updateField('color', e.target.value)}
                  className="sr-only"
                  tabIndex={-1}
                />
              </div>
            </div>
            <div className="mt-2 flex gap-1.5">
              {CONNECTION_COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => updateField('color', c)}
                  className="w-5 h-5 rounded-sm transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: formData.color === c ? `2px solid ${c}` : 'none',
                    outlineOffset: 2,
                  }}
                  title={c}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Database Engine</label>
            <AppSelect
              value={currentEngine}
              onChange={(value) => handleEngineChange(value as DatabaseEngine)}
              options={Object.values(ENGINE_DEFINITIONS).map((engine) => ({
                value: engine.id,
                label: engine.label,
              }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="block text-sm text-muted mb-1">Host</label>
            <input
              value={formData.host}
              onChange={(event) => updateField('host', event.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
              placeholder={engineDefinition.placeholderHost}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Port</label>
            <input
              type="text"
              inputMode="numeric"
              value={formData.port !== undefined ? String(formData.port) : ''}
              onChange={(event) => {
                const val = event.target.value.replace(/[^0-9]/g, '');
                setFormData((current) => ({ ...current, port: val === '' ? undefined : Number(val) }));
              }}
              placeholder={String(engineDefinition.defaultPort)}
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
              required
            />
          </div>
        </div>

        {currentEngine === 'oracle' ? (
          <div className="space-y-3">
            <JdkSetupBanner />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="block text-sm text-muted mb-1">
                  {(formData.oracleConnectionType ?? 'serviceName') === 'sid' ? 'SID' : engineDefinition.databaseLabel}
                </label>
                <input
                  value={formData.database}
                  onChange={(event) => updateField('database', event.target.value)}
                  className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                  placeholder={engineDefinition.placeholderDatabase}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">Oracle Mode</label>
                <AppSelect
                  value={formData.oracleConnectionType ?? 'serviceName'}
                  onChange={(value) => updateField('oracleConnectionType', value as OracleConnectionType)}
                  options={[
                    { value: 'serviceName', label: 'Service Name' },
                    { value: 'sid', label: 'SID' },
                  ]}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-muted mb-1">Oracle Driver Properties</label>
              <textarea
                value={formData.oracleDriverProperties ?? ''}
                onChange={(event) => updateField('oracleDriverProperties', event.target.value)}
                className="min-h-20 w-full resize-y rounded border border-border bg-background px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
                placeholder={ORACLE_DRIVER_PROPERTIES_PLACEHOLDER}
              />
              <p className="mt-1 text-xs text-muted">
                Uma propriedade por linha no formato <code>chave=valor</code>. Os defaults do app continuam sendo aplicados.
              </p>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm text-muted mb-1">{engineDefinition.databaseLabel}</label>
            <input
              value={formData.database}
              onChange={(event) => updateField('database', event.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
              placeholder={engineDefinition.placeholderDatabase}
              required
            />
          </div>
        )}

        {currentEngine === 'postgres' ? (
          <div>
            <label className="block text-sm text-muted mb-1">SSL Mode</label>
            <AppSelect
              value={formData.postgresSslMode ?? 'prefer'}
              onChange={(value) => updateField('postgresSslMode', value as PostgresSslMode)}
              options={[
                { value: 'disable', label: 'Disable' },
                { value: 'prefer', label: 'Prefer' },
                { value: 'require', label: 'Require' },
              ]}
            />
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 border-t border-border/50 pt-3 md:grid-cols-2">
          <div>
            <label className="block text-sm text-muted mb-1">User</label>
            <input
              value={formData.user}
              onChange={(event) => updateField('user', event.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Password</label>
            <div className="relative">
              <input
                type={showMainPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={(event) => updateField('password', event.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-1.5 pr-10 text-sm focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowMainPassword((current) => !current)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-text"
                aria-label={showMainPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showMainPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="block text-sm text-muted mb-1">Connect Timeout (seconds)</label>
            <input
              type="number"
              min={3}
              max={120}
              value={formData.connectTimeoutSeconds ?? 10}
              onChange={(event) => updateField('connectTimeoutSeconds', Number(event.target.value))}
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div className="flex items-end">
            <label className="flex w-full cursor-pointer select-none items-center gap-2 rounded border border-border/70 bg-background/40 px-3 py-2">
              <input
                type="checkbox"
                checked={Boolean(formData.autoReconnect ?? true)}
                onChange={(event) => updateField('autoReconnect', event.target.checked)}
                style={{ accentColor: cc }}
              />
              <span className="text-sm text-text">Auto-reconnect on open failure</span>
            </label>
          </div>
        </div>

        {/* ── SSH Tunnel section ── */}
        <div className="rounded border" style={{ borderColor: ccBorder }}>
          {/* Section label */}
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-0">
            <div className="h-px flex-1" style={{ background: ccBorder }} />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: hexToRgba(cc, 0.55) }}>
              SSH Tunnel
            </span>
            <div className="h-px flex-1" style={{ background: ccBorder }} />
          </div>

          {/* Toggle row */}
          <button
            type="button"
            onClick={() => updateSshField('enabled', !sshEnabled)}
            className="flex w-full items-center justify-between px-4 py-3 transition-colors"
            style={{ background: sshEnabled ? ccBg : 'transparent' }}
          >
            <div className="flex items-center gap-2.5">
              <ArrowLeftRight size={14} style={{ color: cc }} />
              <span className="text-sm font-semibold" style={{ color: cc }}>Use SSH Tunnel</span>
            </div>
            <span
              className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
              style={{ color: cc, border: `1px solid ${ccBorder}`, background: hexToRgba(cc, 0.08) }}
            >
              {sshEnabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </button>

          {/* Fields */}
          {sshEnabled && (
            <div className="animate-in fade-in space-y-3 border-t px-4 pb-4 pt-3" style={{ borderColor: ccBorder }}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="md:col-span-3">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: hexToRgba(cc, 0.8) }}>SSH Host</label>
                  <input
                    value={formData.ssh?.host}
                    onChange={(event) => updateSshField('host', event.target.value)}
                    className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none"
                    placeholder="ec2-3-89-226-227.compute-1.amazonaws.com"
                    required={sshEnabled}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: hexToRgba(cc, 0.8) }}>SSH Port</label>
                  <input
                    type="number"
                    value={formData.ssh?.port}
                    onChange={(event) => updateSshField('port', Number(event.target.value))}
                    className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none"
                    required={sshEnabled}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: hexToRgba(cc, 0.8) }}>SSH User</label>
                  <input
                    value={formData.ssh?.user}
                    onChange={(event) => updateSshField('user', event.target.value)}
                    className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none"
                    required={sshEnabled}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: hexToRgba(cc, 0.8) }}>Authentication Method</label>
                  <AppSelect
                    value={sshAuthMethod}
                    onChange={(value) => handleSshAuthMethodChange(value as SshAuthMethod)}
                    options={[
                      { value: 'password', label: 'Password' },
                      { value: 'privateKey', label: 'Public Key (SSH key pair)' },
                    ]}
                  />
                </div>
              </div>

              {sshAuthMethod === 'password' ? (
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: hexToRgba(cc, 0.8) }}>SSH Password</label>
                  <div className="relative">
                    <input
                      type={showSshPassword ? 'text' : 'password'}
                      value={formData.ssh?.password}
                      onChange={(event) => updateSshField('password', event.target.value)}
                      className="w-full rounded border border-border bg-background px-3 py-1.5 pr-10 text-sm focus:outline-none"
                      placeholder="Optional"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSshPassword((current) => !current)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-text"
                      aria-label={showSshPassword ? 'Ocultar senha SSH' : 'Mostrar senha SSH'}
                    >
                      {showSshPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: hexToRgba(cc, 0.8) }}>Private Key Path</label>
                    <input
                      value={formData.ssh?.privateKeyPath}
                      onChange={(event) => updateSshField('privateKeyPath', event.target.value)}
                      className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none"
                      placeholder="~/.ssh/id_rsa"
                      required={sshAuthMethod === 'privateKey'}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: hexToRgba(cc, 0.8) }}>Passphrase</label>
                    <div className="relative">
                      <input
                        type={showPassphrase ? 'text' : 'password'}
                        value={formData.ssh?.passphrase}
                        onChange={(event) => updateSshField('passphrase', event.target.value)}
                        className="w-full rounded border border-border bg-background px-3 py-1.5 pr-10 text-sm focus:outline-none"
                        placeholder="Optional"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassphrase((current) => !current)}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-text"
                        aria-label={showPassphrase ? 'Ocultar passphrase' : 'Mostrar passphrase'}
                      >
                        {showPassphrase ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {testMessage ? (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              testState === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : testState === 'error'
                  ? 'border-red-500/30 bg-red-500/10 text-red-200'
                  : 'border-border bg-background/40 text-muted'
            }`}
          >
            {testMessage}
          </div>
        ) : null}

        {saveAsNewToast ? (
          <div className="rounded-lg border border-border px-3 py-2 text-sm" style={{ borderColor: ccBorder, background: ccBg, color: cc }}>
            {saveAsNewToast}
          </div>
        ) : null}
      </form>
    </div>
    </div>

      {/* ── Fixed footer ── */}
      <div className="shrink-0 flex items-center justify-end gap-3 border-t border-border/60 px-5 py-4">
        <button
          type="button"
          onClick={() => void handleTestConnection()}
          disabled={testState === 'testing'}
          className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm transition-colors disabled:opacity-50"
          style={{ borderColor: ccBorder, color: cc, background: ccBg }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ccBgHover; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ccBg; }}
        >
          {testState === 'testing' ? <PulseLoader color={cc} size="xs" surface="transparent" /> : <CheckCircle size={14} />}
          {testState === 'testing' ? 'Testing...' : 'Test Connection'}
        </button>
        {initialConnection ? (
          <button
            type="button"
            onClick={() => {
              const payload = buildPayload(formData);
              if (!payload) return;
              const cloned: typeof payload = {
                ...payload,
                id: crypto.randomUUID(),
                name: `${payload.name} (copy)`,
                createdAt: Date.now(),
                lastConnectedAt: undefined,
                avgLatencyMs: undefined,
                engineVersion: undefined,
              };
              addConnection(cloned);
              setSaveAsNewToast(`Connection "${cloned.name}" created.`);
              window.setTimeout(() => setSaveAsNewToast(null), 2500);
            }}
            className="rounded border border-border px-4 py-2 text-sm text-text transition-colors hover:bg-border/40"
          >
            {t('saveAsNew')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-transparent px-4 py-2 text-sm text-text transition-colors hover:bg-border"
        >
          Cancel
        </button>
        <button
          type="submit"
          form="connection-form"
          className="rounded bg-primary px-4 py-2 text-sm text-white transition-colors hover:bg-blue-600"
        >
          {initialConnection ? 'Update Connection' : 'Save Connection'}
        </button>
      </div>
    </div>
  );
}

function currentNameOrImportedName(currentName: string | undefined, importedName: string | undefined): string | undefined {
  if (currentName && currentName.trim().length > 0) {
    return currentName;
  }

  if (importedName && importedName.trim().length > 0) {
    return importedName;
  }

  return undefined;
}

function buildPayload(formData: Partial<ConnectionConfig>): ConnectionConfig | null {
  if (!formData.name || !formData.host || !formData.port || !formData.user || !formData.database || !formData.engine) {
    return null;
  }

  const ssh = formData.ssh?.enabled
    ? {
        enabled: true,
        host: formData.ssh.host,
        port: formData.ssh.port ? Number(formData.ssh.port) : 22,
        user: formData.ssh.user,
        authMethod: formData.ssh.authMethod ?? 'password',
        password: formData.ssh.authMethod === 'password' ? formData.ssh.password || undefined : undefined,
        privateKeyPath: formData.ssh.authMethod === 'privateKey' ? formData.ssh.privateKeyPath || undefined : undefined,
        passphrase: formData.ssh.authMethod === 'privateKey' ? formData.ssh.passphrase || undefined : undefined,
      }
    : { enabled: false };

  return {
    id: formData.id ?? crypto.randomUUID(),
    name: formData.name,
    engine: formData.engine,
    host: formData.host,
    port: Number(formData.port),
    user: formData.user,
    password: formData.password || undefined,
    database: formData.database,
    connectTimeoutSeconds: Math.min(120, Math.max(3, Number(formData.connectTimeoutSeconds ?? 10))),
    autoReconnect: Boolean(formData.autoReconnect ?? true),
    postgresSslMode: formData.engine === 'postgres' ? formData.postgresSslMode ?? 'prefer' : undefined,
    oracleConnectionType: formData.engine === 'oracle' ? formData.oracleConnectionType ?? 'serviceName' : undefined,
    oracleDriverProperties:
      formData.engine === 'oracle' ? formData.oracleDriverProperties?.trim() || undefined : undefined,
    preferredSchema: formData.preferredSchema?.trim() || undefined,
    color: formData.color?.trim() || undefined,
    ssh,
  };
}

function parseConnectionString(value: string): Partial<ConnectionConfig> | null {
  const raw = value.trim();
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    const protocol = url.protocol.replace(':', '');

    if (protocol !== 'postgres' && protocol !== 'postgresql') {
      return null;
    }

    const host = url.hostname;
    const port = Number(url.port || 5432);
    const database = decodeURIComponent(url.pathname.replace(/^\//, '') || 'postgres');
    const user = decodeURIComponent(url.username || 'postgres');
    const password = url.password ? decodeURIComponent(url.password) : '';
    const sslMode = normalizeImportedSslMode(url.searchParams.get('sslmode'), host);

    return {
      name: inferConnectionName(host),
      engine: 'postgres',
      host,
      port,
      database,
      user,
      password,
      postgresSslMode: sslMode,
      connectTimeoutSeconds: 10,
      autoReconnect: true,
      ssh: {
        enabled: false,
      },
    };
  } catch {
    return null;
  }
}

function inferConnectionName(host: string): string {
  if (!host) {
    return 'Imported Postgres';
  }

  const firstSegment = host.split('.')[0];
  if (!firstSegment) {
    return 'Imported Postgres';
  }

  return `Imported ${firstSegment}`;
}

function normalizeImportedSslMode(value: string | null, host: string): PostgresSslMode {
  if (value === 'disable' || value === 'require') {
    return value;
  }

  if (host.includes('supabase.co')) {
    return 'require';
  }

  return 'prefer';
}

function extractErrorMessage(error: unknown): string {
  const raw = extractRawErrorMessage(error);
  const normalized = raw.trim();
  const lower = normalized.toLowerCase();

  if (
    lower.includes('unable to locate a java runtime') ||
    lower.includes('java/jdk') ||
    lower.includes('failed to compile oracle jdbc sidecar') ||
    lower.includes('failed to run javac for oracle sidecar')
  ) {
    return 'Conexao Oracle requer Java/JDK instalado na maquina. Instale um JDK e tente novamente.';
  }

  return normalized || 'Erro desconhecido ao testar a conexao.';
}

function extractRawErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    if ('toString' in error && typeof error.toString === 'function') {
      const asString = error.toString();
      if (asString && asString !== '[object Object]') {
        return asString;
      }
    }

    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    if ('error' in error && typeof error.error === 'string') {
      return error.error;
    }
  }

  return 'Erro desconhecido ao testar a conexao.';
}

function buildConnectionSubtitle(conn: ConnectionConfig): string {
  const parts: string[] = [];
  if (conn.engine === 'oracle') parts.push('Oracle');
  else if (conn.engine === 'mysql') parts.push('MySQL');
  else parts.push('PostgreSQL');
  if (conn.ssh?.enabled) parts.push('SSH');
  if (conn.name) parts.push(conn.name);
  return parts.join(' · ');
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2.5">
      <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted/60">{label}</span>
      <span className="truncate text-xs font-medium text-text/80">{value}</span>
    </div>
  );
}

function formatMetaDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMetaRelative(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatMetaDate(timestamp);
}
