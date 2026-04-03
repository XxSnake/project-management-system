import './globals.css';
import Sidebar from '@/components/Sidebar';

export const metadata = {
    title: '工程检测项目管理系统',
    description: '用于工程检测合同识别、工作记录管理、产值统计与数据安全维护的桌面控制台。',
};

export default function RootLayout({ children }) {
    return (
        <html lang="zh-CN" suppressHydrationWarning>
            <body className="app-body">
                <div className="app-backdrop" aria-hidden="true">
                    <div className="app-orb app-orb-a" />
                    <div className="app-orb app-orb-b" />
                    <div className="app-grid" />
                </div>
                <div className="app-layout">
                    <Sidebar />
                    <main className="main-content">{children}</main>
                </div>
            </body>
        </html>
    );
}
