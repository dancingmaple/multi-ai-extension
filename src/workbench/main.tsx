// ============================================================
// workbench/main.tsx - 工作台独立全屏页入口
// ============================================================
import React from 'react';
import ReactDOM from 'react-dom/client';
import 'reactflow/dist/style.css';
import './workbench.css';
import { WorkbenchApp } from './WorkbenchApp';

const root = document.getElementById('workbench-root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <WorkbenchApp />
    </React.StrictMode>
  );
}
