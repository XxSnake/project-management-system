'use client';

import { useEffect, useState } from 'react';

const EMPTY_FORM = { testItemName: '', unit: '', unitPrice: '' };

function formatMoney(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? `CNY ${amount.toFixed(2)}` : '-';
}

export default function PricesPage() {
    const [prices, setPrices] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);

    const refreshPrices = async () => {
        const response = await fetch('/api/prices', { cache: 'no-store' });
        const data = await response.json();
        setPrices(Array.isArray(data) ? data : []);
    };

    useEffect(() => {
        let cancelled = false;

        fetch('/api/prices', { cache: 'no-store' })
            .then((response) => response.json())
            .then((data) => {
                if (!cancelled) {
                    setPrices(Array.isArray(data) ? data : []);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    console.error('加载指导价失败:', error);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const handleSubmit = async (event) => {
        event.preventDefault();
        await fetch('/api/prices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
        });
        setForm(EMPTY_FORM);
        setShowForm(false);
        await refreshPrices();
    };

    const handleDelete = async (id) => {
        if (!confirm('确认删除这条内部指导价吗？')) return;
        await fetch('/api/prices', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        await refreshPrices();
    };

    const numericPrices = prices.map((item) => Number(item.unitPrice)).filter(Number.isFinite);
    const averagePrice = numericPrices.length > 0 ? numericPrices.reduce((sum, item) => sum + item, 0) / numericPrices.length : 0;
    const unitCount = new Set(prices.map((item) => item.unit).filter(Boolean)).size;

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Data Fabric</div>
                    <h2>单价管理</h2>
                    <p className="page-desc">维护内部指导价，为没有合同价目表的项目和工作记录提供回退计价基础。</p>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => void refreshPrices()}>刷新</button>
                    <button type="button" className={showForm ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => setShowForm((current) => !current)}>
                        {showForm ? '收起表单' : '新增指导价'}
                    </button>
                </div>
            </div>

            <div className="page-body">
                <div className="metric-grid">
                    <div className="metric-card"><div className="metric-label">指导价条目</div><div className="metric-value neon">{prices.length}</div><div className="metric-meta">系统内的内部单价记录总数</div></div>
                    <div className="metric-card"><div className="metric-label">平均单价</div><div className="metric-value">{averagePrice.toFixed(2)}</div><div className="metric-meta">按现有指导价粗略计算的均值</div></div>
                    <div className="metric-card"><div className="metric-label">单位种类</div><div className="metric-value success">{unitCount}</div><div className="metric-meta">当前价目表覆盖的单位数量</div></div>
                    <div className="metric-card"><div className="metric-label">最高单价</div><div className="metric-value magenta">{numericPrices.length > 0 ? Math.max(...numericPrices).toFixed(2) : '0.00'}</div><div className="metric-meta">便于快速识别异常指导价</div></div>
                </div>

                {showForm ? (
                    <form onSubmit={handleSubmit} className="card stack">
                        <div className="card-header">
                            <div className="card-copy">
                                <div className="panel-eyebrow">Fallback Pricing</div>
                                <div className="panel-title">新增内部指导价</div>
                                <div className="panel-note">当项目没有关联合同单价时，系统会优先回退到这里的内部指导价。</div>
                            </div>
                            <button type="submit" className="btn btn-primary">保存单价</button>
                        </div>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>检测项目名称</label>
                                <input className="form-input" required value={form.testItemName} onChange={(event) => setForm((current) => ({ ...current, testItemName: event.target.value }))} placeholder="例如：沉降观测、轻型动力触探" />
                            </div>
                            <div className="form-group">
                                <label>单位</label>
                                <input className="form-input" value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder="例如：点、组、根" />
                            </div>
                            <div className="form-group">
                                <label>单价</label>
                                <input className="form-input" type="number" step="0.01" required value={form.unitPrice} onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))} placeholder="0.00" />
                            </div>
                        </div>
                    </form>
                ) : null}

                <section className="table-shell">
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Pricing Table</div>
                            <div className="panel-title">内部指导价列表</div>
                            <div className="panel-note">用于工作记录自动匹配不到合同价目时的 fallback 计价。</div>
                        </div>
                        <div className="table-toolbar-meta"><span>总数：{prices.length}</span><span>单位种类：{unitCount}</span></div>
                    </div>

                    {prices.length === 0 ? (
                        <div className="empty-state">
                            <div>
                                <div className="empty-dot" />
                                <strong>还没有内部指导价</strong>
                                新增后，系统在无合同单价时可以自动回退计价。
                            </div>
                        </div>
                    ) : (
                        <div className="data-table-shell">
                            <table className="data-table">
                                <thead><tr><th>检测项目名称</th><th>单位</th><th>内部单价</th><th>操作</th></tr></thead>
                                <tbody>
                                    {prices.map((item) => (
                                        <tr key={item.id}>
                                            <td style={{ fontWeight: 600 }}>{item.testItemName}</td>
                                            <td>{item.unit || '-'}</td>
                                            <td>{formatMoney(item.unitPrice)}</td>
                                            <td><button type="button" className="btn btn-danger" style={{ minHeight: '32px', padding: '0 12px', fontSize: '0.72rem' }} onClick={() => void handleDelete(item.id)}>删除</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </>
    );
}
