// ============================================================
// workbench-test/main.tsx - AI 请求/获取核心链路测试页入口
// ============================================================
import ReactDOM from 'react-dom/client';
import 'reactflow/dist/style.css';
import './test.css';
import { TestConsole } from './TestConsole';

const root = document.getElementById('test-root');
if (root) {
  ReactDOM.createRoot(root).render(<TestConsole />);
}
