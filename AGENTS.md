# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Codex 并行开发 Git 工作流

本项目可能同时运行多个 Codex/Agent 任务。为避免互相覆盖，每个任务都必须使用独立的 Git worktree 和独立分支。

核心原则：

- 一个任务对应一个 worktree
- 一个任务对应一个分支
- 当前任务只能修改自己的 worktree
- 当前任务只能提交、推送、合并和清理自己的分支
- 不得覆盖、删除或强推其他任务的 worktree 或分支

### 任务开始

开始开发前，先基于最新主分支为当前任务创建独立 worktree，并在该 worktree 中创建当前任务专属分支。

分支名称为对这个开发需求的简要描述。如：
- codex-add-login
- codex-fix-login-err

### 开发过程

所有代码修改都必须发生在当前任务自己的 worktree 中。

不要在主仓库目录或其他任务的 worktree 中改代码。

提交前需要检查当前 Git 状态，确保只包含当前任务相关改动。不要提交临时文件、日志文件、构建产物或其他无关内容。

### 推送

任务完成后，只推送当前任务对应的分支。

不得推送、覆盖或强推其他任务的分支。

### 合并

除非任务明确要求，否则不要自行合并到主分支。

如果任务要求合并，只允许将当前任务分支合并回主分支。合并前应先同步最新主分支，并处理当前任务产生的冲突。

### 清理

任务完成并确认已推送或合并后，可以清理当前任务对应的 worktree 和分支。

清理范围仅限当前任务自己的 worktree 和分支，不得影响其他任务。

### 异常处理

如果发现 worktree 或分支已存在、当前分支不符合预期、出现冲突、推送失败或 Git 状态异常，应先说明当前状态，再处理问题。

不得通过覆盖、强推、删除其他分支或清理其他 worktree 的方式解决问题。

## 6. 写好中文注释

目标：
让读者在阅读代码时，能快速理解：
- 数据是如何流动的（输入 → 处理 → 输出）
- 业务是如何执行的（关键流程与规则）
- 数据结构和对象的真实含义
- 以及“为什么这样设计”

请遵循以下规范：

【一、数据处理函数（必须）】
- 明确说明：
  - 输入参数的含义、类型及约束（是否可为空、取值范围等）
  - 返回值的含义和结构
- 必要时补充：
  - 边界条件处理（如空值、异常值）
  - 数据转换规则

【二、业务流程函数（必须）】
- 用结构化方式说明“核心业务流程”（不是逐行翻译代码）
- 强调：
  - 关键步骤
  - 业务规则（如校验、限制条件）
  - 可能的失败路径或分支逻辑
- 避免写成简单步骤罗列

【三、类 / 数据结构（必须）】
- 描述该对象在业务中的角色和语义
- 说明关键字段含义（不是逐字段翻译，而是业务意义）
- 如果存在约束或状态流转规则，必须说明

【四、设计意图（关键要求）】
- 对以下情况必须解释“为什么这样做”：
  - 非直观实现
  - 特殊写法或技巧
  - 性能优化（如缓存、批处理等）
  - 业务上的特殊决策
  - workaround / hack

【五、严格避免低质量注释】
- 不要重复代码表面含义
- 不要解释显而易见的逻辑
- 不要写无意义或过时内容
- 不要写情绪化或主观评价

【六、风格要求】
- 注释简洁、准确、专业
- 优先使用清晰结构（分点或分段）
- 函数必须有完整说明（作用 / 参数 / 返回值）
- 行内注释仅在必要时使用

【七、可读性优先】
- 如果通过优化命名或结构可以减少注释，请直接优化代码

## 7. 合理使用superpower插件

1. 小需求（轻量任务）

满足以下任一条件：

- 单步即可完成
- 不需要外部数据或复杂推理
- 不需要长期状态或多轮操作
- 用户只是询问 / 简单生成 / 修改

👉 执行策略：

❌ 不调用 Superpower
✅ 直接用自身能力完成
✅ 控制输出简洁高效

2. 大需求（复杂任务）

满足以下任一条件：

多步骤（≥3步）
需要规划、拆解、执行、校验
涉及复杂逻辑 / 数据处理 / 多工具协同
用户目标较模糊，需要推理和澄清
需要高可靠性输出（方案 / 报告 / 项目级）

👉 执行策略：

✅ 必须调用 Superpower
✅ 使用完整流程
