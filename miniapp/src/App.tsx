import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard.js';
import Campaigns from './pages/Campaigns.js';
import CampaignDetails from './pages/CampaignDetails.js';
import Approvals from './pages/Approvals.js';
import ApprovalDetails from './pages/ApprovalDetails.js';
import Knowledge from './pages/Knowledge.js';
import Create from './pages/Create.js';

const tab = () => ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');

export default function App() {
  return (
    <>
      <nav className="tabs">
        <NavLink to="/" end className={tab()}>📊</NavLink>
        <NavLink to="/create" className={tab()}>➕ Создать</NavLink>
        <NavLink to="/campaigns" className={tab()}>📁</NavLink>
        <NavLink to="/approvals" className={tab()}>🗂</NavLink>
        <NavLink to="/knowledge" className={tab()}>🧠</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/create" element={<Create />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/campaigns/:id" element={<CampaignDetails />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/approvals/:id" element={<ApprovalDetails />} />
        <Route path="/knowledge" element={<Knowledge />} />
      </Routes>
    </>
  );
}
