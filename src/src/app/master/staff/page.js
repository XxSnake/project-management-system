'use client';

import { useEffect, useState } from 'react';

const EMPTY_FORM = { name: '', phone: '', role: '' };

export default function StaffPage() {
    const [staffList, setStaffList] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);

    const refreshStaff = async () => {
        const response = await fetch('/api/staff', { cache: 'no-store' });
        const data = await response.json();
        setStaffList(Array.isArray(data) ? data : []);
    };

    useEffect(() => {
        let cancelled = false;

        fetch('/api/staff', { cache: 'no-store' })
            .then((response) => response.json())
            .then((data) => {
                if (!cancelled) {
                    setStaffList(Array.isArray(data) ? data : []);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    console.error('加载人员失败:', error);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const handleSubmit = async (event) => {
        event.preventDefault();
        await fetch('/api/staff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
        });
        setForm(EMPTY_FORM);
        setShowForm(false);
        await refreshStaff();
    };

    const handleDelete = async (id) => {
        if (!confirm('确认删除这位人员吗？')) return;
        await fetch('/api/staff', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        await refreshStaff();
    };

    const phoneCount = staffList.filter((item) => item.phone).length;
    const roleCount = new Set(staffList.map((item) => item.role).filter(Boolean)).size;
    const missingPhoneCount = staffList.length - phoneCount;

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Data Fabric</div>
                    <h2>人员管理</h2>
                    <p className="page-desc">维护检测团队档案、联系方式和角色信息，为工作记录与产值归集提供基础数据。</p>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => void refreshStaff()}>刷新</button>
                    <button type="button" className={showForm ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => setShowForm((current) => !current)}>
                        {showForm ? '收起表单' : '新增人员'}
                    </button>
                </div>
            </div>

            <div className="page-body">
                <div className="metric-grid">
                    <div className="metric-card"><div className="metric-label">人员总数</div><div className="metric-value neon">{staffList.length}</div><div className="metric-meta">当前系统中的人员档案</div></div>
                    <div className="metric-card"><div className="metric-label">已填手机号</div><div className="metric-value">{phoneCount}</div><div className="metric-meta">便于后续通知和线下联络</div></div>
                    <div className="metric-card"><div className="metric-label">角色种类</div><div className="metric-value success">{roleCount}</div><div className="metric-meta">当前已使用的岗位标签数量</div></div>
                    <div className="metric-card"><div className="metric-label">待补联系方式</div><div className="metric-value magenta">{missingPhoneCount}</div><div className="metric-meta">没有手机号的人员条目</div></div>
                </div>

                {showForm ? (
                    <form onSubmit={handleSubmit} className="card stack">
                        <div className="card-header">
                            <div className="card-copy">
                                <div className="panel-eyebrow">Roster Intake</div>
                                <div className="panel-title">新增人员档案</div>
                                <div className="panel-note">录入后可直接用于工作日志人员拆分和报表排行。</div>
                            </div>
                            <button type="submit" className="btn btn-primary">保存人员</button>
                        </div>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>姓名</label>
                                <input className="form-input" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="输入人员姓名" />
                            </div>
                            <div className="form-group">
                                <label>手机号</label>
                                <input className="form-input" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="输入联系电话" />
                            </div>
                            <div className="form-group">
                                <label>角色</label>
                                <input className="form-input" value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} placeholder="例如：检测员、项目经理" />
                            </div>
                        </div>
                    </form>
                ) : null}

                <section className="table-shell">
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Roster</div>
                            <div className="panel-title">人员列表</div>
                            <div className="panel-note">用于工作记录拆分、项目协作和产值统计。</div>
                        </div>
                        <div className="table-toolbar-meta"><span>总数：{staffList.length}</span><span>角色：{roleCount}</span></div>
                    </div>

                    {staffList.length === 0 ? (
                        <div className="empty-state">
                            <div>
                                <div className="empty-dot" />
                                <strong>还没有人员档案</strong>
                                从上方表单录入第一位成员即可开始使用。
                            </div>
                        </div>
                    ) : (
                        <div className="data-table-shell">
                            <table className="data-table">
                                <thead><tr><th>姓名</th><th>手机号</th><th>角色</th><th>操作</th></tr></thead>
                                <tbody>
                                    {staffList.map((item) => (
                                        <tr key={item.id}>
                                            <td style={{ fontWeight: 600 }}>{item.name}</td>
                                            <td>{item.phone || '-'}</td>
                                            <td>{item.role ? <span className="badge badge-info">{item.role}</span> : <span className="badge badge-warning">未设置</span>}</td>
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
