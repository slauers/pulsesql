import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle, Eye, EyeOff, LoaderCircle, XCircle } from 'lucide-react';
import { createDefaultConnectionForm, ENGINE_DEFINITIONS } from './connection-engines';
import { ConnectionConfig, DatabaseEngine, OracleConnectionType, PostgresSslMode, SshAuthMethod, useConnectionsStore } from '../../store/connections';
import AppSelect from '../../components/ui/AppSelect';

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
  const [formData, setFormData] = useState<Partial<ConnectionConfig>>(initialConnection ?? createDefaultConnectionForm());
  const [showMainPassword, setShowMainPassword] = useState(false);
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [connectionString, setConnectionString] = useState('');
  const [importMessage, setImportMessage] = useState('');

  const currentEngine = formData.engine ?? 'postgres';
  const engineDefinition = ENGINE_DEFINITIONS[currentEngine];
  const sshEnabled = Boolean(formData.ssh?.enabled);
  const sshAuthMethod = formData.ssh?.authMethod ?? 'password';

  const updateField = <K extends keyof ConnectionConfig>(field: K, value: ConnectionConfig[K]) => {
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
      engine,
      port: defaults.port,
      database: current.database && current.engine === engine ? current.database : defaults.database,
      host: current.host || defaults.host,
      user: defaults.user,
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
    setImportMessage('Connection string importada com sucesso.');
    setTestState('idle');
    setTestMessage('');
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-300">
          {initialConnection ? 'Edit Connection' : 'New Connection'}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImportPanel((current) => !current)}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
          >
            Import from connection string
          </button>
          <button onClick={onClose} className="text-muted hover:text-text">
            ✕
          </button>
        </div>
      </div>

      {showImportPanel ? (
        <div className="mb-5 rounded-2xl border border-border/70 bg-surface/65 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.28)]">
          <div className="mb-2 text-sm font-medium text-text">Import Connection String</div>
          <textarea
            value={connectionString}
            onChange={(event) => setConnectionString(event.target.value)}
            placeholder="postgresql://postgres:password@host:5432/postgres?sslmode=require"
            className="min-h-24 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm font-mono text-text outline-none transition-colors focus:border-primary"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
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

      <form onSubmit={handleSubmit} className="space-y-5 glass-panel p-4 md:p-6 rounded-2xl border border-border shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-muted mb-1">Connection Name</label>
            <input
              value={formData.name}
              onChange={(event) => updateField('name', event.target.value)}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="Production DB"
              required
            />
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm text-muted mb-1">Host</label>
            <input
              value={formData.host}
              onChange={(event) => updateField('host', event.target.value)}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder={engineDefinition.placeholderHost}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Port</label>
            <input
              type="number"
              value={formData.port}
              onChange={(event) => updateField('port', Number(event.target.value))}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
              required
            />
          </div>
        </div>

        {currentEngine === 'oracle' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-muted mb-1">
                  {(formData.oracleConnectionType ?? 'serviceName') === 'sid' ? 'SID' : engineDefinition.databaseLabel}
                </label>
                <input
                  value={formData.database}
                  onChange={(event) => updateField('database', event.target.value)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
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
                className="min-h-32 w-full resize-y bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
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
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border/50 pt-4">
          <div>
            <label className="block text-sm text-muted mb-1">User</label>
            <input
              value={formData.user}
              onChange={(event) => updateField('user', event.target.value)}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
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
                className="w-full bg-background border border-border rounded px-3 py-2 pr-10 text-sm focus:border-primary focus:outline-none"
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

        <div className="flex items-center justify-end gap-3 rounded-xl border border-border/60 bg-background/35 px-3 py-2">
          {testState !== 'idle' ? (
            <div className="flex items-center gap-2 text-xs">
              {testState === 'testing' ? (
                <>
                  <LoaderCircle size={14} className="animate-spin text-primary" />
                  <span className="text-primary/80">Testing...</span>
                </>
              ) : testState === 'success' ? (
                <>
                  <CheckCircle size={14} className="text-emerald-400" />
                  <span className="text-emerald-300">Connection OK</span>
                </>
              ) : (
                <>
                  <XCircle size={14} className="text-red-400" />
                  <span className="text-red-300">Connection failed</span>
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-muted mb-1">Connect Timeout (seconds)</label>
            <input
              type="number"
              min={3}
              max={120}
              value={formData.connectTimeoutSeconds ?? 10}
              onChange={(event) => updateField('connectTimeoutSeconds', Number(event.target.value))}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer select-none rounded border border-border/70 bg-background/40 px-3 py-2.5">
              <input
                type="checkbox"
                checked={Boolean(formData.autoReconnect ?? true)}
                onChange={(event) => updateField('autoReconnect', event.target.checked)}
                className="accent-primary"
              />
              <span className="text-sm text-text">Auto-reconnect on open failure</span>
            </label>
          </div>
        </div>

        <div className="pt-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sshEnabled}
              onChange={(event) => updateSshField('enabled', event.target.checked)}
              className="accent-primary"
            />
            <span className="text-sm font-medium text-emerald-400">Use SSH Tunnel</span>
          </label>
        </div>

        {sshEnabled && (
          <div className="bg-surface/50 p-4 rounded border border-emerald-500/30 space-y-4 animate-in fade-in slide-in-from-top-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-3">
                <label className="block text-sm text-emerald-400/80 mb-1">SSH Host</label>
                <input
                  value={formData.ssh?.host}
                  onChange={(event) => updateSshField('host', event.target.value)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                  placeholder="203.0.113.50"
                  required={sshEnabled}
                />
              </div>
              <div>
                <label className="block text-sm text-emerald-400/80 mb-1">SSH Port</label>
                <input
                  type="number"
                  value={formData.ssh?.port}
                  onChange={(event) => updateSshField('port', Number(event.target.value))}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                  required={sshEnabled}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-emerald-400/80 mb-1">SSH User</label>
                <input
                  value={formData.ssh?.user}
                  onChange={(event) => updateSshField('user', event.target.value)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                  required={sshEnabled}
                />
              </div>
              <div>
                <label className="block text-sm text-emerald-400/80 mb-1">Authentication Method</label>
                <AppSelect
                  value={sshAuthMethod}
                  onChange={(value) => handleSshAuthMethodChange(value as SshAuthMethod)}
                  options={[
                    { value: 'password', label: 'Password' },
                    { value: 'privateKey', label: 'Public Key (SSH key pair)' },
                  ]}
                  className="focus:border-emerald-500 hover:border-emerald-500/40"
                />
              </div>
            </div>

            {sshAuthMethod === 'password' ? (
              <div>
                <label className="block text-sm text-emerald-400/80 mb-1">SSH Password</label>
                <div className="relative">
                  <input
                    type={showSshPassword ? 'text' : 'password'}
                    value={formData.ssh?.password}
                    onChange={(event) => updateSshField('password', event.target.value)}
                    className="w-full bg-background border border-border rounded px-3 py-2 pr-10 text-sm focus:border-emerald-500 focus:outline-none"
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-emerald-400/80 mb-1">Private Key Path</label>
                  <input
                    value={formData.ssh?.privateKeyPath}
                    onChange={(event) => updateSshField('privateKeyPath', event.target.value)}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                    placeholder="~/.ssh/id_rsa"
                    required={sshAuthMethod === 'privateKey'}
                  />
                </div>
                <div>
                  <label className="block text-sm text-emerald-400/80 mb-1">Passphrase</label>
                  <div className="relative">
                    <input
                      type={showPassphrase ? 'text' : 'password'}
                      value={formData.ssh?.passphrase}
                      onChange={(event) => updateSshField('passphrase', event.target.value)}
                      className="w-full bg-background border border-border rounded px-3 py-2 pr-10 text-sm focus:border-emerald-500 focus:outline-none"
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

        {testMessage ? (
          <div
            className={`rounded-xl border px-3 py-2 text-sm ${
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

        <div className="pt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => void handleTestConnection()}
            disabled={testState === 'testing'}
            className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm border border-border text-text hover:bg-border/40 transition-colors disabled:opacity-50"
          >
            {testState === 'testing' ? <LoaderCircle size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            Test Connection
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded text-sm text-text hover:bg-border border border-transparent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 rounded text-sm bg-primary text-white hover:bg-blue-600 transition-colors"
          >
            {initialConnection ? 'Update Connection' : 'Save Connection'}
          </button>
        </div>
      </form>
    </div>
    </div>
  );
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
