import { useState } from 'react';
import { createDefaultConnectionForm, ENGINE_DEFINITIONS } from './connection-engines';
import { ConnectionConfig, DatabaseEngine, OracleConnectionType, SshAuthMethod, useConnectionsStore } from '../../store/connections';

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

    if (!formData.name || !formData.host || !formData.port || !formData.user || !formData.database || !formData.engine) {
      return;
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

    const payload: ConnectionConfig = {
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
      oracleConnectionType: formData.engine === 'oracle' ? formData.oracleConnectionType ?? 'serviceName' : undefined,
      oracleDriverProperties:
        formData.engine === 'oracle' ? formData.oracleDriverProperties?.trim() || undefined : undefined,
      ssh,
    };

    if (initialConnection) {
      updateConnection(payload);
    } else {
      addConnection(payload);
    }

    onClose();
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-300">
          {initialConnection ? 'Edit Connection' : 'New Connection'}
        </h2>
        <button onClick={onClose} className="text-muted hover:text-text">
          ✕
        </button>
      </div>

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
            <select
              value={currentEngine}
              onChange={(event) => handleEngineChange(event.target.value as DatabaseEngine)}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {Object.values(ENGINE_DEFINITIONS).map((engine) => (
                <option key={engine.id} value={engine.id}>
                  {engine.label}
                </option>
              ))}
            </select>
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
                <select
                  value={formData.oracleConnectionType ?? 'serviceName'}
                  onChange={(event) => updateField('oracleConnectionType', event.target.value as OracleConnectionType)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="serviceName">Service Name</option>
                  <option value="sid">SID</option>
                </select>
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
            <input
              type="password"
              value={formData.password}
              onChange={(event) => updateField('password', event.target.value)}
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
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
                <select
                  value={sshAuthMethod}
                  onChange={(event) => handleSshAuthMethodChange(event.target.value as SshAuthMethod)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  <option value="password">Password</option>
                  <option value="privateKey">Public Key (SSH key pair)</option>
                </select>
              </div>
            </div>

            {sshAuthMethod === 'password' ? (
              <div>
                <label className="block text-sm text-emerald-400/80 mb-1">SSH Password</label>
                <input
                  type="password"
                  value={formData.ssh?.password}
                  onChange={(event) => updateSshField('password', event.target.value)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                  placeholder="Optional"
                />
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
                  <input
                    type="password"
                    value={formData.ssh?.passphrase}
                    onChange={(event) => updateSshField('passphrase', event.target.value)}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                    placeholder="Optional"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="pt-4 flex justify-end gap-3">
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
