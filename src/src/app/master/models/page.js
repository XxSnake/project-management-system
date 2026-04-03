'use client';

import { useEffect, useState } from 'react';

const EMPTY_FORM = {
    id: '',
    name: '',
    providerType: 'openai-compatible',
    apiUrl: '',
    model: '',
    apiKey: '',
    notes: '',
    enabled: true,
    supportsText: true,
    supportsVision: true,
    supportsOcr: false,
};

const TASK_LABELS = {
    contractOcr: '合同 OCR 解析',
    contractVision: '合同视觉识别',
    contractText: '合同文本识别',
    worklogMatching: '工作日志智能匹配',
    contractReview: '合同结果校对',
};

function getCapabilityEnabled(provider, capability) {
    if (capability === 'ocr') return provider.supportsOcr;
    if (capability === 'vision') return provider.supportsVision;
    return provider.supportsText;
}

function getAlertClass(type) {
    if (type === 'error') return 'alert-danger';
    if (type === 'success') return 'alert-success';
    return 'alert-warning';
}

export default function ModelProvidersPage() {
    const [providers, setProviders] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [taskBindings, setTaskBindings] = useState({});
    const [configPath, setConfigPath] = useState('');
    const [form, setForm] = useState(EMPTY_FORM);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testingId, setTestingId] = useState('');
    const [message, setMessage] = useState(null);

    const loadData = async () => {
        setLoading(true);
        setMessage(null);

        try {
            const response = await fetch('/api/models', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || '加载模型配置失败');
            setProviders(payload.providers || []);
            setTasks(payload.tasks || []);
            setTaskBindings(payload.taskBindings || {});
            setConfigPath(payload.configPath || '');
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
    }, []);

    const resetForm = () => setForm(EMPTY_FORM);

    const handleProviderTypeChange = (providerType) => {
        setForm((current) => {
            if (providerType === 'glm-ocr-maas') {
                return {
                    ...current,
                    providerType,
                    apiUrl: current.apiUrl || 'https://api.z.ai/api/paas/v4/layout_parsing',
                    model: current.model || 'glm-ocr',
                    supportsText: false,
                    supportsVision: false,
                    supportsOcr: true,
                };
            }

            return {
                ...current,
                providerType,
                apiUrl: current.apiUrl || 'https://api.edgefn.net/v1/chat/completions',
                supportsText: true,
                supportsVision: true,
                supportsOcr: false,
            };
        });
    };

    const handleSaveProvider = async (event) => {
        event.preventDefault();
        setSaving(true);
        setMessage(null);

        try {
            const response = await fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || '保存模型失败');
            setProviders(payload.providers || []);
            setTasks(payload.tasks || []);
            setTaskBindings(payload.taskBindings || {});
            setConfigPath(payload.configPath || '');
            resetForm();
            setMessage({ type: 'success', text: '模型配置已保存。' });
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setSaving(false);
        }
    };

    const handleSaveBindings = async () => {
        setSaving(true);
        setMessage(null);

        try {
            const response = await fetch('/api/models', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskBindings }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || '保存任务绑定失败');
            setProviders(payload.providers || []);
            setTasks(payload.tasks || []);
            setTaskBindings(payload.taskBindings || {});
            setConfigPath(payload.configPath || '');
            setMessage({ type: 'success', text: '任务绑定已更新。' });
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (provider) => {
        if (provider.isSystem) return;
        if (!confirm(`确认删除模型“${provider.name}”吗？`)) return;

        try {
            const response = await fetch('/api/models', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: provider.id }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || '删除模型失败');
            setProviders(payload.providers || []);
            setTasks(payload.tasks || []);
            setTaskBindings(payload.taskBindings || {});
            setConfigPath(payload.configPath || '');
            if (form.id === provider.id) resetForm();
            setMessage({ type: 'success', text: '模型已删除。' });
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        }
    };

    const handleEdit = (provider) => {
        setForm({
            id: provider.id,
            name: provider.name,
            providerType: provider.providerType || 'openai-compatible',
            apiUrl: provider.apiUrl,
            model: provider.model,
            apiKey: '',
            notes: provider.notes || '',
            enabled: provider.enabled,
            supportsText: provider.supportsText,
            supportsVision: provider.supportsVision,
            supportsOcr: provider.supportsOcr,
        });
        setMessage({ type: 'warning', text: '已载入模型配置。如不修改 API Key，可保持 API Key 输入框为空。' });
    };

    const handleTest = async (providerOrForm) => {
        setTestingId(providerOrForm.id || 'draft');
        setMessage(null);

        try {
            const response = await fetch('/api/models/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(providerOrForm),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || '模型测试失败');
            setMessage({
                type: 'success',
                text: `测试成功：${payload.providerName} / ${payload.model}${payload.preview ? ` / ${payload.preview}` : ''}`,
            });
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setTestingId('');
        }
    };

    const enabledCount = providers.filter((item) => item.enabled).length;
    const ocrCount = providers.filter((item) => item.supportsOcr).length;
    const boundCount = tasks.filter((task) => taskBindings[task.id]).length;

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Inference Mesh</div>
                    <h2>模型 API 管理</h2>
                    <p className="page-desc">统一管理合同 OCR、文本识别、视觉模型和智能匹配用到的外部模型入口，支持后续自由切换。</p>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => void loadData()}>刷新</button>
                </div>
            </div>

            <div className="page-body">
                {message ? <div className={`alert ${getAlertClass(message.type)}`}>{message.text}</div> : null}

                <div className="metric-grid">
                    <div className="metric-card"><div className="metric-label">模型入口</div><div className="metric-value neon">{providers.length}</div><div className="metric-meta">当前已保存的模型提供方数量</div></div>
                    <div className="metric-card"><div className="metric-label">启用中</div><div className="metric-value success">{enabledCount}</div><div className="metric-meta">可参与真实业务任务的模型数</div></div>
                    <div className="metric-card"><div className="metric-label">OCR 能力</div><div className="metric-value">{ocrCount}</div><div className="metric-meta">支持文档 OCR 的模型入口数量</div></div>
                    <div className="metric-card"><div className="metric-label">任务绑定</div><div className="metric-value magenta">{boundCount}</div><div className="metric-meta">已绑定到业务任务的位点数</div></div>
                </div>

                <div className="split-grid-wide">
                    <section className="card stack">
                        <div className="card-header">
                            <div className="card-copy">
                                <div className="panel-eyebrow">Config</div>
                                <div className="panel-title">配置文件与任务绑定</div>
                                <div className="panel-note">每个任务位点都可以绑定一个具备对应能力的模型入口。</div>
                            </div>
                            <button type="button" className="btn btn-primary" onClick={handleSaveBindings} disabled={saving || loading}>保存绑定</button>
                        </div>

                        <div className="surface-item">
                            <div className="surface-title">配置文件路径</div>
                            <div className="surface-note">{configPath || '首次保存后会自动生成本地配置文件。'}</div>
                        </div>

                        <div className="surface-grid">
                            {tasks.map((task) => (
                                <div className="form-group" key={task.id}>
                                    <label>{TASK_LABELS[task.id] || task.label}</label>
                                    <select
                                        className="form-select"
                                        value={taskBindings[task.id] || ''}
                                        onChange={(event) => setTaskBindings((current) => ({ ...current, [task.id]: event.target.value || null }))}
                                    >
                                        <option value="">未绑定</option>
                                        {providers
                                            .filter((provider) => provider.enabled)
                                            .filter((provider) => getCapabilityEnabled(provider, task.capability))
                                            .map((provider) => (
                                                <option key={provider.id} value={provider.id}>
                                                    {provider.name} / {provider.model}
                                                </option>
                                            ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    </section>

                    <form onSubmit={handleSaveProvider} className="card stack">
                        <div className="card-header">
                            <div className="card-copy">
                                <div className="panel-eyebrow">Provider Form</div>
                                <div className="panel-title">{form.id ? '编辑模型入口' : '新增模型入口'}</div>
                                <div className="panel-note">支持 OpenAI-compatible 和 GLM-OCR MaaS 两种接入方式。</div>
                            </div>
                            <div className="page-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => void handleTest(form)} disabled={testingId === 'draft'}>{testingId === 'draft' ? '测试中' : '测试表单'}</button>
                                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '保存中' : (form.id ? '保存修改' : '新增模型')}</button>
                            </div>
                        </div>

                        <div className="form-grid">
                            <div className="form-group">
                                <label>模型名称</label>
                                <input className="form-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：GLM-OCR MaaS" required />
                            </div>
                            <div className="form-group">
                                <label>提供方类型</label>
                                <select className="form-select" value={form.providerType} onChange={(event) => handleProviderTypeChange(event.target.value)}>
                                    <option value="openai-compatible">OpenAI-compatible / Chat Completions</option>
                                    <option value="glm-ocr-maas">GLM-OCR MaaS / Layout Parsing</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>模型名</label>
                                <input className="form-input" value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} placeholder={form.providerType === 'glm-ocr-maas' ? '例如：glm-ocr' : '例如：GLM-5'} required />
                            </div>
                            <div className="form-group">
                                <label>API Key</label>
                                <input className="form-input" type="password" value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder={form.id ? '留空表示不修改' : '输入接口密钥'} required={!form.id} />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>接口地址</label>
                            <input className="form-input" value={form.apiUrl} onChange={(event) => setForm((current) => ({ ...current, apiUrl: event.target.value }))} placeholder={form.providerType === 'glm-ocr-maas' ? '例如：https://api.z.ai/api/paas/v4/layout_parsing' : '例如：https://api.edgefn.net/v1/chat/completions'} required />
                        </div>

                        <div className="form-group">
                            <label>备注</label>
                            <textarea className="form-textarea" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="可记录供应商、计费说明或适用场景" />
                        </div>

                        <div className="checkbox-row">
                            <label className="checkbox-chip"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />启用</label>
                            <label className="checkbox-chip"><input type="checkbox" checked={form.supportsText} onChange={(event) => setForm((current) => ({ ...current, supportsText: event.target.checked }))} disabled={form.providerType === 'glm-ocr-maas'} />文本任务</label>
                            <label className="checkbox-chip"><input type="checkbox" checked={form.supportsVision} onChange={(event) => setForm((current) => ({ ...current, supportsVision: event.target.checked }))} disabled={form.providerType === 'glm-ocr-maas'} />视觉任务</label>
                            <label className="checkbox-chip"><input type="checkbox" checked={form.supportsOcr} onChange={(event) => setForm((current) => ({ ...current, supportsOcr: event.target.checked }))} disabled={form.providerType === 'glm-ocr-maas'} />OCR 任务</label>
                        </div>

                        {form.id ? <button type="button" className="btn btn-secondary" onClick={resetForm}>取消编辑</button> : null}
                    </form>
                </div>

                <section className="table-shell">
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Provider Mesh</div>
                            <div className="panel-title">已配置模型入口</div>
                            <div className="panel-note">这里显示已保存的 API 地址、能力标签和实际绑定的任务位点。</div>
                        </div>
                        <div className="table-toolbar-meta"><span>总数：{providers.length}</span><span>启用：{enabledCount}</span></div>
                    </div>

                    {loading ? (
                        <div className="empty-state"><div><div className="empty-dot" /><strong>正在加载模型配置</strong>稍候即可看到当前的入口与任务绑定。</div></div>
                    ) : providers.length === 0 ? (
                        <div className="empty-state"><div><div className="empty-dot" /><strong>还没有模型入口</strong>先在上方表单增加一个模型，再绑定到业务任务。</div></div>
                    ) : (
                        <div className="provider-grid">
                            {providers.map((provider) => {
                                const boundTasks = tasks.filter((task) => taskBindings[task.id] === provider.id);
                                return (
                                    <div key={provider.id} className="card provider-card stack-sm">
                                        <div className="card-header" style={{ marginBottom: 0 }}>
                                            <div className="card-copy">
                                                <div className="panel-title">
                                                    {provider.name}
                                                    {provider.isSystem ? ' [环境默认]' : ''}
                                                </div>
                                                <div className="provider-meta">{provider.model}</div>
                                                <div className="provider-meta">{provider.apiUrl}</div>
                                            </div>
                                            <div className="chip-row">
                                                <span className={`badge ${provider.enabled ? 'badge-success' : 'badge-warning'}`}>{provider.enabled ? '启用' : '停用'}</span>
                                                <span className="badge badge-info">{provider.supportsText ? '文本' : '无文本'}</span>
                                                <span className="badge badge-info">{provider.supportsVision ? '视觉' : '无视觉'}</span>
                                                <span className="badge badge-info">{provider.supportsOcr ? 'OCR' : '无 OCR'}</span>
                                            </div>
                                        </div>

                                        <div className="provider-meta">API Key: {provider.maskedApiKey || '未配置'}</div>
                                        <div className="provider-meta">类型: {provider.providerType}</div>
                                        <div className="provider-meta">绑定任务: {boundTasks.length > 0 ? boundTasks.map((task) => TASK_LABELS[task.id] || task.label).join(' / ') : '未绑定'}</div>
                                        {provider.notes ? <div className="surface-item"><div className="surface-note">{provider.notes}</div></div> : null}

                                        <div className="page-actions">
                                            <button type="button" className="btn btn-secondary" onClick={() => void handleTest({ id: provider.id })} disabled={testingId === provider.id}>
                                                {testingId === provider.id ? '测试中' : '测试连接'}
                                            </button>
                                            {!provider.isSystem ? <button type="button" className="btn btn-primary" onClick={() => handleEdit(provider)}>编辑</button> : null}
                                            {!provider.isSystem ? <button type="button" className="btn btn-danger" onClick={() => void handleDelete(provider)}>删除</button> : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>
        </>
    );
}
