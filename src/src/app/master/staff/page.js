'use client';

import { useEffect, useState } from 'react';

export default function StaffPage() {
    const [staffList, setStaffList] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editingName, setEditingName] = useState('');

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
        if (!newName.trim()) return;
        await fetch('/api/staff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName.trim() }),
        });
        setNewName('');
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

    const handleNameClick = (item) => {
        setEditingId(item.id);
        setEditingName(item.name);
    };

    const handleNameSave = async (id) => {
        const trimmed = editingName.trim();
        if (!trimmed) {
            setEditingId(null);
            return;
        }

        const original = staffList.find((s) => s.id === id);
        if (original && original.name === trimmed) {
            setEditingId(null);
            return;
        }

        await fetch('/api/staff', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name: trimmed }),
        });
        setEditingId(null);
        await refreshStaff();
    };

    const handleNameKeyDown = (e, id) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void handleNameSave(id);
        } else if (e.key === 'Escape') {
            setEditingId(null);
        }
    };

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Data Fabric</div>
                    <h2>人员管理</h2>
                    <p className="page-desc">维护检测团队人员档案，为工作记录与产值归集提供基础数据。点击姓名可直接修改。</p>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => void refreshStaff()}>刷新</button>
                    <button type="button" className={showForm ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => setShowForm((current) => !current)}>
                        {showForm ? '收起' : '新增人员'}
                    </button>
                </div>
            </div>

            <div className="page-body">
                <div className="metric-grid">
                    <div className="metric-card"><div className="metric-label">人员总数</div><div className="metric-value neon">{staffList.length}</div><div className="metric-meta">当前系统中的人员档案</div></div>
                </div>

                {showForm ? (
                    <form onSubmit={handleSubmit} className="card stack">
                        <div className="card-header">
                            <div className="card-copy">
                                <div className="panel-eyebrow">Roster Intake</div>
                                <div className="panel-title">新增人员</div>
                            </div>
                            <button type="submit" className="btn btn-primary">保存</button>
                        </div>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>姓名</label>
                                <input className="form-input" required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="输入人员姓名" autoFocus />
                            </div>
                        </div>
                    </form>
                ) : null}

                <section className="table-shell">
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Roster</div>
                            <div className="panel-title">人员列表</div>
                            <div className="panel-note">点击姓名可直接修改，回车保存，Esc 取消。</div>
                        </div>
                        <div className="table-toolbar-meta"><span>总数：{staffList.length}</span></div>
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
                                <thead><tr><th>姓名</th><th style={{ width: 80 }}>操作</th></tr></thead>
                                <tbody>
                                    {staffList.map((item) => (
                                        <tr key={item.id}>
                                            <td style={{ fontWeight: 600 }}>
                                                {editingId === item.id ? (
                                                    <input
                                                        className="form-input"
                                                        value={editingName}
                                                        onChange={(e) => setEditingName(e.target.value)}
                                                        onBlur={() => void handleNameSave(item.id)}
                                                        onKeyDown={(e) => handleNameKeyDown(e, item.id)}
                                                        autoFocus
                                                        style={{ margin: '-4px 0', padding: '4px 8px', fontSize: 'inherit', fontWeight: 'inherit' }}
                                                    />
                                                ) : (
                                                    <span
                                                        onClick={() => handleNameClick(item)}
                                                        style={{ cursor: 'pointer' }}
                                                        onMouseEnter={(e) => { e.target.style.color = 'var(--color-accent)'; }}
                                                        onMouseLeave={(e) => { e.target.style.color = 'inherit'; }}
                                                        title="点击修改姓名"
                                                    >
                                                        {item.name}
                                                    </span>
                                                )}
                                            </td>
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
