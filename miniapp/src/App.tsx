import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard.js';
import Campaigns from './pages/Campaigns.js';
import Approvals from './pages/Approvals.js';
import Knowledge from './pages/Knowledge.js';

const tab = (label: string) => ({ isActive }: { isActive: boolean }) =>
  isActive ? 'active' : '';

export default function App() {
  return (
    <>
      <nav className="tabs">
        <NavLink to="/" end className={tab('Дашборд')}>📊 Дашборд</NavLink>
        <NavLink to="/campaigns" className={tab('Кампании')}>📁 Кампании</NavLink>
        <NavLink to="/approvals" className={tab('Черновики')}>🗂 Черновики</NavLink>
        <NavLink to="/knowledge" className={tab('Знания')}>🧠 Знания</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/knowledge" element={<Knowledge />} />
      </Routes>
    </>
  );
}
