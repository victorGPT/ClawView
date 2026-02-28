# OpenClaw Discord + ACP 配置策略手册（本机落地版）

> 目的：把这套“线程里稳定可执行”的配置一次写清楚，后续直接按文档执行，不再每次临时查。

## 0. 适用范围

- 运行环境：`/Users/farmer/.openclaw/openclaw.json`
- 主要场景：Discord 线程协作、ACP(Codex)执行、主会话编排与回报
- 当前策略基线：
  - `acp.enabled = true`
  - `acp.backend = "acpx"`
  - `acp.maxConcurrentSessions = 10`
  - `channels.discord.threadBindings.spawnAcpSessions = true`
  - `tools.sessions.visibility = "all"`
  - `tools.agentToAgent.enabled = true`

---

## 1. 先讲原则（避免走偏）

### 1.1 `systemPrompt` 还能用，但不是“硬约束引擎”

- 官方文档里 `systemPrompt` 仍然是有效配置项（并未废弃）。
- 但它主要用于行为引导（软约束），真正的硬约束要靠：
  - allowlist / groupPolicy
  - tool policy
  - approvals
  - sandbox

### 1.2 Discord topic 不是 system prompt

- Discord channel topic 在 OpenClaw 里是 **untrusted context**，不是系统提示词。
- 所以治理规则不要只靠 topic。

### 1.3 稳定规则放哪

推荐分层：
1) **硬策略**：`openclaw.json`
2) **长期协作规则**：`AGENTS.md`
3) **频道/线程临时策略**：channel-level `systemPrompt`

---

## 2. 配置总览（建议模板）

> 以下是你当前策略的建议“标准形态”（可直接对照现网配置）。

```json5
{
  "acp": {
    "enabled": true,
    "backend": "acpx",
    "maxConcurrentSessions": 10
  },
  "channels": {
    "discord": {
      "groupPolicy": "allowlist",
      "capabilities": [
        "discord", "comms", "threads", "markdown", "embeds",
        "components-v2", "buttons", "modals", "forms", "inlineButtons"
      ],
      "threadBindings": {
        "enabled": true,
        "spawnSubagentSessions": true,
        "spawnAcpSessions": true
      },
      "guilds": {
        "1470455812156821567": {
          "channels": {
            "1475866899895156788": {
              "allow": true,
              "systemPrompt": "Dispatch mode (main): if user asks 开子区/开线程/子区处理, parent channel only creates the thread and posts handoff context. Do not run worker analysis/execution in parent channel unless user explicitly asks."
            }
          }
        }
      }
    }
  },
  "tools": {
    "sessions": {
      "visibility": "all"
    },
    "agentToAgent": {
      "enabled": true
    }
  }
}
```

---

## 3. ACP-only 执行策略（推荐）

## 3.1 线程里怎么执行

- 实现任务统一通过 ACP (`runtime="acp"`, `agentId="codex"`)。
- 主会话角色：
  - 编排
  - 风险门控
  - 汇总回报
- 子会话角色：
  - 实现
  - 校验
  - 提交/推送

## 3.2 进度可见性（关键）

为了主会话能看子会话状态，保留：
- `tools.sessions.visibility = "all"`
- `tools.agentToAgent.enabled = true`

否则会出现 `sessions_history/sessions_send forbidden`，导致进度盲飞。

---

## 4. “三段回报”硬规则（建议固化到 AGENTS.md）

每次 ACP 任务必须输出三次可见回报：

1. **开工回报**：`sessionKey + runId`
2. **里程碑回报**：关键校验/卡点
3. **收尾回报**：`commit hash + 分支 + 验证摘要`（或 blocker）

并要求子任务末尾触发一次 system event（done 信号），避免静默完成。

---

## 5. 修改配置的标准流程（避免配置漂移）

1. 先取 schema（防止字段名猜错）
2. 再 patch（最小变更）
3. 自动重启后做健康检查

建议命令序列：

```bash
openclaw gateway status
# （或通过 gateway.config.schema / gateway.config.get 对照）
```

> 原则：优先 `config.patch`，少用整份 `config.apply` 覆盖。

---

## 6. 验证清单（每次变更后都跑）

- 网关状态正常
- Discord 路由正常（消息能在预期频道回复）
- ACP 能创建并绑定线程
- 主会话能读取子会话进度
- 若有执行任务：能拿到 commit/push 回报

建议检查：

```bash
openclaw status
openclaw channels status --probe
openclaw logs --follow
```

---

## 7. 常见坑（已踩过）

1. 只改 topic 不改配置，结果规则不生效（topic 是 untrusted context）
2. 只开 ACP，不开 sessions 可见性，主会话看不到子会话进度
3. 把长期治理规则塞在 channel systemPrompt，后续难维护、难复用
4. 用全量 apply 覆盖，误伤无关配置

---

## 8. 建议的文件落点（长期维护）

- 运行时硬策略：`/Users/farmer/.openclaw/openclaw.json`
- 全局协作规则：`/Users/farmer/.openclaw/workspace-codex-dev/AGENTS.md`
- 项目协作规则：`/Users/farmer/.openclaw/workspace/repos-main/ClawView/AGENTS.md`
- 本手册：`/Users/farmer/.openclaw/workspace-codex-dev/docs/openclaw-discord-acp-config-playbook.md`

---

## 9. 维护约定（建议）

- 每次改策略都在本手册追加一条“变更记录”（日期 + 变更点 + 影响）
- 先改文档再改配置，确保策略与实现同步
- 变更后必须做一次最小回归（路由 + ACP + 可见性）

---

## 10. 参考（官方文档）

- System Prompt: `https://docs.openclaw.ai/concepts/system-prompt`
- Discord: `https://docs.openclaw.ai/channels/discord`
- Configuration Reference: `https://docs.openclaw.ai/gateway/configuration-reference`
- Security: `https://docs.openclaw.ai/gateway/security`
