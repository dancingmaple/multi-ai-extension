// ============================================================
// workbench/main.tsx - 工作台独立全屏页入口
// ============================================================
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';
import './workbench.css';
import { WorkbenchApp } from './WorkbenchApp';

const root = document.getElementById('workbench-root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      {/* useReactFlow / screenToFlowPosition 等必须在 ReactFlowProvider 内部调用，
          否则白屏报 zustand provider 错误（error#001） */}
      <ReactFlowProvider>
        <WorkbenchApp />
      </ReactFlowProvider>
    </React.StrictMode>
  );
}
