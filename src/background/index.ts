// Message router auto-initializes on import (registers listeners synchronously)
import './messageRouter';
// External bridge：让「年轮 / 工作台」网页能调用本插件并接收流式回答
import './externalBridge';
// 嵌入视图：剥离 X-Frame-Options / CSP，允许把 AI 网页嵌进插件 iframe
import { installEmbedRules } from './dnr';
installEmbedRules();
