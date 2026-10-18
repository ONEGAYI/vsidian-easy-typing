# 五 Tab 自绘设置页（工单 #55）

上游 `src/settings/easy_typing_settings_tab.ts` 的 5-Tab 设置页整体移植：24 项普通设置从「平台声明式表单为主」翻转为**五 Tab 自绘页承载呈现**，与规则四分区同页；同时接入平台作用域（用户默认 / 当前工作区）与全局设置搜索定位。设置定义保持 `registerDefinitions` 注册不注销（全局搜索索引与平台基础表单的驱动面，平台基础表单降为页内次级页签）。事实源模块：`src/settings/tabs-model.ts`（Tab/卡片归属纯函数）、`src/settingsTabsUi.ts`（页面装配）、`src/page-settings.ts`（入口注入）、`src/settings.css`（样式追加）；测试矩阵：`test/settings-tabs-model.test.ts` / `settings-tabs-ui.test.ts` / `settings-tabs-scope.test.ts` / `settings-tabs-locate.test.ts`。设置字段与声明面事实源在 [settings-mapping.md](settings-mapping.md)，规则分区内部语义在 [rules-ui.md](rules-ui.md)。

## 页面结构

- **hero 顶部块**：项目名（`settingsTabs.heroTitle`）+ 上游来源链接（MIT 双署名致敬，链 Yaozhuwa/easy-typing-obsidian，`_blank` + `noreferrer noopener`）。
- **Tab 框架**：`nav[role=tablist]` 五按钮 + 五 `section[role=tabpanel]`；aria 配对完整（`aria-selected` / `aria-controls` / `aria-labelledby`）；键盘导航左右/上下循环、Home/End、roving tabIndex（活动钮 0 其余 -1，焦点随键盘移动）。
- **面板常驻、hidden 切换**：五个 panel 全部挂载在 DOM，非活动 panel `[hidden]` + `aria-hidden`——不因切 Tab 销毁重建。目的：spacing 分区防御网（串行写队列/脏标记/编辑保护/DOM 读面，见 rules-ui.md）在 Tab 化后时序不变；规则分区草稿/焦点不因切 Tab 丢失。
- **页面级状态行**：`role=status`（`data-vet-status` 三态），设置写入提示与规则分区共享，6s 自动清除；计时器单所有者——规则分区的状态提示经 hosts `statusSink` 上交页面 `showStatus` 统一计时，后到提示不被先到提示的计时器提前清除。
- **Tab 态**：内存保存，默认「编辑增强」，页面卸载即复位（上游同为内存态；平台关闭组件详情即卸载自绘页）。`switchTab` 为受控切换 API，搜索定位经同一内部路径切页。

## 五 Tab 归属表

| Tab（id） | 内容（序 = 呈现序） | 数据源 |
| --- | --- | --- |
| 编辑增强（`edit-enhance`） | 「增强编辑设置」卡 6 项：betterCodeEdit / betterBackspace / tabout / enhanceModA / smartPaste / newLineBelow（本仓键殿后，上游无此字段） | 定义 + SETTINGS_TOPIC |
| 自动格式化（`auto-format`） | 「自动格式化设置」卡 3 项（autoFormat / autoFormatPaste / autoCapital）→ **语言间空格策略分区**（rulesUi spacing 挂入点）→ 「行内元素间空格」卡 6 项 → 「前缀词典」卡 1 项 → 「自定义正则区块」卡 3 项 → 「指定文件不自动格式化」卡（excludeFiles） | 定义 + SETTINGS_TOPIC + RulesSettingsClient |
| 内置规则（`builtin-rules`） | 用户级标注 + 内置规则分区（20 条 + 重置 + 已停用折叠区，rulesUi builtin） | RulesSettingsClient |
| 自定义规则（`user-rules`） | 用户级标注 + 用户规则分区（新增/导入/导出/排序 + 编辑模态框，rulesUi user） | RulesSettingsClient |
| 其他设置（`other`） | 「实验功能」卡 4 项（strictModeEnter / strictLineMode / collapsePersistentEnter / debug）→ 数据目录展示分区（rulesUi storage，殿后） | 定义 + SETTINGS_TOPIC + RulesSettingsClient.storageUri |

- **键计数**：编辑增强 6 / 自动格式化 14（auto-format 组 13 键 + excludeFiles）/ 其他设置 4；内置/自定义规则两 Tab 无设置行（规则分区承载）。卡片键并集 = 24 键全集且每键恰好一次（单一事实源 `SETTINGS_TAB_CARDS`，Tab 键清单由卡片折叠而来）。
- **excludeFiles 特例**：声明在 `general` 组（#477 四组声明），自绘页按上游语义归「自动格式化」Tab（上游「指定文件不自动格式化」卡片）。**声明分组与自绘页归属是两套呈现，互不冲突**：声明分组（edit-enhance / auto-format / general / experimental 四组）继续驱动平台基础表单与搜索索引的分组呈现，自绘归属（`GROUP_TO_TAB` 路由）只管本页 Tab 落位；`groupKeyToTabId` 对未知组键抛错（守配置错误），`settingKeyToTabId` / `groupKeyToCardAnchor` 对未注册键返回 null（守运行期外来输入）。
- **组定位落点**：`groupKeyToCardAnchor` 锚到组首卡片（组内定义键按卡片声明序首个命中的卡片）——auto-format 组锚总开关卡、general 组锚排除文件卡、edit-enhance 键锚增强编辑卡、experimental 组锚实验功能卡。

## 设置行渲染与写入链路

- **控件形态由定义元数据驱动**：boolean → checkbox；string enum → select（档位文案用 `enumLabels` 双语标签，缺失回退枚举值本身）；普通 string → text；`multiline` string 与 array → textarea（array 每行一项）。行文案用既有 `settings[key].name/desc`，不另造第二份。
- **控件创建即应用定义默认值**（`src/settings/defaults.ts` 同源，不经 get）：装载窗口（get 在途）与首读失败期间不落浏览器原生初值（checkbox 未选 / enum 首项 / 空文本）；autoFormat 联动在首读完成后接管（装载窗口全行禁用——联动不参与禁用归因，见首读三态）。
- **首读三态**（审查轮 R2 + PR #59 复审收紧）：loading（默认值在场 + **全部 24 设置行禁用**，无骨架屏——首读完成前普通设置明确不可编辑，规则分区走独立通道照常可用）→ loaded（首个有效快照**强制回填**——穿透聚焦草稿保护，禁用窗口无合法草稿，防「仅聚焦」挡存储真值；联动随之接管禁用语义后行启用）；failed（首 get 拒绝、抛错或快照形状非法）→ 失败横幅（`role=alert`，错误提示 + 重试入口）+ 共享状态行 failed 提示 + 全行禁用带行级提示（未读到的值不当已保存值编辑）；重试成功恢复可编辑、联动接管，并清理状态行**仍属于本次读取失败**的残留提示——仅当当前文本仍等于失败文案（未被规则通道较新消息覆盖）时立即清除，不无条件清空共享状态行。已成功读取后的后续 get 失败保持既有静默语义（值是已读真值而非默认值，写失败路径另有状态行提示）。
- **可访问名称**（审查轮 R2，WCAG 4.1.2 / F68）：全部 24 控件统一 `aria-labelledby` 指向行内标题 span 唯一 id（`vsidian-easy-typing-setting-name-<key>`，checkbox 一并统一不另用 aria-label）；说明 span 唯一 id（`vsidian-easy-typing-setting-desc-<key>`）+ `aria-describedby`。
- **写入触发 = `change` 事件**（失焦/回车，非逐键——避免通道风暴）；excludeFiles 写入按行拆分、逐行 trim、丢弃空行。首读完成前的 change 一律忽略（写入守卫——装载窗口/失败态行已禁用，此为程序化路径的兜底防线）。
- **读写通道**：初值/回显经 `SETTINGS_TOPIC.get` 的 `effective`（默认回填后的生效值）；写入经 `SETTINGS_TOPIC.update`，载荷 `{scope, patch}`（scope 见下节作用域）；**写后重拉刷新**（成功同步存储真值，失败把控件拉回，失败 reason 经状态行提示——含 `no-workspace` 拒绝码）。重拉两条确定性语义：**跳过聚焦中控件**（当前编辑中的草稿不被写后/作用域切换/清除覆盖的重拉覆盖，失焦后下一次重拉照常应用存储真值）与**到达序令牌**（并发重拉按发起序自增令牌结算，挂起旧快照迟到回包弃置，不覆盖新快照）。写/清除失败的强制回滚对账键是**集合**：连续多次失败的全部未对账键由真正结算的刷新（未被序号弃置、走到应用循环的那笔）统一强制回滚并清空集合；弃置/异常/提前 return 不消费，留待下一笔结算兜底（审查轮 R2 修单槽反例：A、B 先后失败且 A 聚焦时，旧槽被 B 覆盖 + 聚焦保护使 A 漏回滚）。
- **联动置灰（纯 UI 态，不改变写入）**：`autoFormat` 总开关关闭 → 自动格式化 Tab 下游**设置行**置灰（`aria-disabled` + 类名 + tooltip「总开关已关闭，此设置暂不可用」），总开关自身可用；`userDefinedRegExp` 再受 `userDefinedRegSwitch` 二级联动。打开总开关后下行随写后重拉恢复可用。

## 作用域语义（settingsContext facet 消费）

- **组件消费观察面，不自绘作用域切换器**：作用域选择器（用户默认 / 当前工作区）由平台外壳持有，本组件只消费 `settingsContext.scopeState()` / `onScopeChange`（平台等值不分发）。
- **写入目标层跟随**：`SETTINGS_TOPIC.update` 的 scope 取 `scopeState().scope`——切到工作区层后写入落 workspace 层，切回用户层落 user 层；`onScopeChange` 分发后重拉对齐显示（effective 与来源徽章都随 layers 解析变化）。`hasWorkspace === false` 时平台快照不出现 workspace 来源，覆盖入口自然不出现；写入/清除遭 `no-workspace` 拒绝经状态行兜底并回滚控件。
- **行级来源徽章 + 清除覆盖**：仅 facet 在场且 `sources[key] === 'workspace'` 的行呈现「工作区覆盖」徽章与「清除覆盖」动作；**清除覆盖 = 恢复继承用户默认值，不是恢复出厂默认**（`SETTINGS_TOPIC.clearOverride`，平台 `clearWorkspaceOverride` 语义），清除后重拉（徽章消失 + effective 回退用户层）。
- **按层显示（#60）**：控件显示值与联动随平台选中层计算——`scope === 'user'` 时显示用户层显式值（键未显式保存时出厂默认，不显示被工作区覆盖的合并值），`scope === 'workspace'` 时合并 effective 即工作区视角。数据源是 `SETTINGS_TOPIC.get` 快照的 `userValues`（vsidian#590 供货，宿主 handler 经 spread 自动透传）。写后回显、失败强制回滚、autoFormat/userDefinedRegSwitch 联动取值同经 `displayValueOf` 按层路由。**合并值提示（mergedHint）降级化**：仅在快照无 `userValues` 字段（vsidian#590 前旧宿主）且 `scope === 'user'` 且 `sources[key] === 'workspace'` 时呈现——新宿主下用户层真值直达，提示不再出现（scope=workspace 恒无此提示）。
- **规则 Tab 用户级标注**：规则/富结构存储是 globalStorage 语义用户级（无工作区作用域），内置/自定义规则 panel 顶部静态标注「用户级数据：全局共享，不随工作区隔离」；规则区不出现任何作用域 UI。标注是数据级说明，facet 降级形态下仍在。
- **spacing 分区用户级标注**（审查轮 R2）：自动格式化 Tab 的「语言间空格策略」分区（语言对策略与自定义文字类别）数据写全局 rule-state（用户级），与相邻按作用域保存的普通设置行不同层——标注挂分区近旁（复用规则区标注文案形态），**不把整个自动格式化 Tab 标为用户级**。
- **facet 判空降级**：`settingsContext` 缺席（旧宿主 / 编辑器页形态）→ 无作用域相关 UI（徽章/清除入口不呈现——节点常驻但 `hidden`，不进可访问树），写入目标层固定 `'user'`，页面其余功能完整可用。
- **清单下界**：`vsidianAddon.api ^1.1.0`（settingsContext 自 vsidian 附加组件 API 1.1.0 发行；`^1.1.0` 仍包含宿主 1.2.0，兼容判定不变）。

## 搜索定位链路（locateTarget 消费）

平台全局设置搜索只给落点 `{kind: 'def' | 'group', key}`（键空间与注册 keys / 组键同源），**切页内 Tab 与定位控件是组件自己的职责**。消费面：`onLocateTarget` 订阅（订阅即回放挂起目标）+ 装配时 `locateTarget()` 初值拉取（双保险，重复到达由幂等吸收）。

映射：`def` → 设置行（`settingKeyToTabId` 切 Tab + 行滚动 + 高亮）；`group` → 组首卡片（`groupKeyToCardAnchor`）。高亮形态 = 目标节点 `data-located="<kind>:<key>"` + 样式类，`scrollIntoView({block: 'nearest'})` 滚动进可视区。

三条定位语义（切片 3 落档）：

1. **重复定位不去重，组件幂等是平台契约**——平台刻意不做等值去重，同一目标重复交付即重新滚动/高亮（高亮保持单份，全局单高亮：换目标先清旧标记）。
2. **定位高亮是常驻标记**——null 清除或换目标前不自动消退；作用域切换触发的重拉走单行刷新（不重建 DOM），高亮不丢。
3. **首开定位等首次 `get` 结算后才落位**——目标早于首次渲染（`SETTINGS_TOPIC.get` 未返回）先排队，首次 `refreshSettings` 结算（成败皆算）后补投，避免高亮/滚动落在值尚未应用的行上；排队期间收到 null 则丢弃排队目标。

**未知键静默降级**：未注册键 / 未知组键 / 组内无定义 → 不报错、不切 Tab、不高亮、不滚动、不排队（与平台注册键空间同空间的外来输入）。

## 上游对照

| 上游锚点（easy_typing_settings_tab.ts） | 移植落点 | 语义与偏差 |
| --- | --- | --- |
| 5-Tab 导航（编辑增强/自动格式化/内置规则/自定义规则/其他） | `SETTINGS_TAB_IDS` + Tab 框架 | 同名同序；Tab 态同为内存态（页面卸载复位） |
| Tab2 卡片序（总开关 → 语言对 → 行内空格 → 前缀词典 → 自定义正则 → 排除文件） | `SETTINGS_TAB_CARDS` 卡片分区 | 卡片结构与序对照；「语言间空格策略」为本仓 rulesUi spacing 分区挂入（非设置行，卡片间插入） |
| 上游 `newLineBelow` 无字段 | `editEnhance` 卡末位 | #13 本仓门控键殿后（见 settings-mapping.md §二表末行） |
| excludeFiles 卡片归 Tab2 | `excludeFiles` 卡 → 自动格式化 Tab | 声明面在 `general` 组（两套呈现，见上文归属表节） |
| 上游设置控件（checkbox/dropdown/text/textarea） | 元数据驱动控件形态 | 形态一致；枚举档位用平台 `enumLabels` 双语标签（#477） |
| 作用域（上游无） | settingsContext 消费 | 平台侧扩展面：Obsidian 插件设置单层，无 user/workspace 双层对照——作用域语义为平台原生口径，非移植 |
| 搜索定位（上游无对应自绘页定位） | locateTarget 消费 | 平台全局设置搜索能力（#472 索引驱动 + 交付面），组件补齐切 Tab/滚动/高亮 |

## 验收口径（票面映射）

- **归属映射纯函数**：`test/settings-tabs-model.test.ts`——24 键全覆盖无遗漏、excludeFiles 特例归自动格式化、卡片键并集 = 24 键恰好一次、组路由与卡片锚点两套口径咬合、Tab 计数（6/14/4）、总开关是 autoFormat 卡首键、组未映射的已注册定义判空降级不抛错。
- **Tab 框架与设置行 DOM**：`test/settings-tabs-ui.test.ts`——hero 链接、tablist aria 配对与键盘导航、面板常驻 hidden 切换、24 行渲染与控件形态矩阵、行文案来自既有 i18n、初值经 effective、写入通道（scope user + 写后重拉 + change 触发 + excludeFiles 拆行）、写入失败状态行回滚、联动置灰矩阵（含二级联动与恢复）、规则四分区挂入对应 panel、dispose；审查轮加固——共享状态行单计时器（规则分区提示经 statusSink 上交，先到计时器不提前清除后到提示）、重拉跳过聚焦中控件（草稿保留，失焦后回真值）、并发重拉到达序令牌（旧快照迟到不覆盖新快照）、enumLabelText 直值形态（LocalizedText 直值字符串直返）；审查第二轮加固——装载窗口默认值在场 + 全行禁用（首读完成前不可编辑）、首 get 拒绝/抛错失败三态（默认值 + 横幅重试 + 全行禁用 + 规则分区不受影响 + 重试恢复）、24 控件可访问名称（aria-labelledby 标题 / aria-describedby 说明，id 唯一）、失败回滚键集合（A、B 先后失败 + A 聚焦 + 旧刷新弃置 → 一并强制回滚）；PR #59 第二轮复审加固——装载窗口禁用三反例（tabout 仅聚焦不挡首快照回填 / autoFormat 主开关与下游无矛盾态 / 词典加载窗口零写入不覆盖已存值）、程序化 change 写入守卫、重试恢复清状态行残留（失败文案即清、规则通道较新消息不误清）。
- **作用域接入**：`test/settings-tabs-scope.test.ts`——facet 判空降级（无作用域 UI + 写入固定 user）、写入目标层跟随 scopeState、onScopeChange 重拉对齐、dispose 退订、no-workspace 拒绝提示与控件回滚、规则 Tab 用户级标注（含降级形态仍在）、workspace 徽章显隐、清除覆盖成功（载荷/重拉/回退用户层）/失败（reason 提示、徽章保持）；审查第二轮加固——spacing 分区用户级标注（挂分区近旁、不泛化整 Tab）；**#60 按层显示组**——user 视角层值真显（mergedHint 回收）、未显式保存键出厂默认 + 联动按层、workspace 视角合并、作用域切换显示跟随、写 user 层回显、写失败强制回滚按层；**合并值提示组**——降级为旧宿主形态钉住（`layered=false` mock：合并显示 + 提示在场 + 切换驱动显隐）。
- **搜索定位**：`test/settings-tabs-locate.test.ts`——首开回放（订阅回放 + 初值双投只落一次高亮）、已开立即交付（不触发重拉）、def/group 两类映射与组特例（general 锚排除文件卡）、未知键静默降级、重复目标重入、换目标清旧、null 清除（含排队丢弃）、get 挂起排队补投、dispose 退订、与作用域重拉共存、facet 缺席无定位消费痕迹。
- **真实观感归人工清单**：暗/亮主题真实绘制、中英双语、长内容滚动、物理键盘 Tab 导航、作用域切换/清除覆盖实操、全局搜索定位实操（含重复点击重新滚动）、规则四分区回归——[manual-verification.md](../manual-verification.md) 二十二节（A83–A88）。
- `npm run compile`（三产物构建 + `tsc --noEmit`）通过；全部测试绿，不回归。

## 已知边界

- **首读完成前普通设置不可编辑**（PR #59 复审）：首个 `get` 成功结算前 24 设置行全部禁用（防装载窗口的定义默认值经 change 提交覆盖已存配置——数据丢失路径；也防仅聚焦挡首快照回填）；首个有效快照完成强制回填与联动后启用。规则分区走独立通道不受此门影响。
- **Tab 态不持久化**：内存态，页面卸载即复位默认「编辑增强」；搜索定位的订阅回放可覆盖首开主要 UX 损失。
- **设置值无推送通道**：页面在每次写后/清除后/作用域切换后重拉 `SETTINGS_TOPIC.get` 刷新；跨窗口实时同步不做（平台作用域推送同款边界，见 settings-mapping.md §六）。写入失败（`no-workspace` 等 reason）经状态行提示。残余边界：重拉跳过聚焦中控件（保草稿语义），外部变更在焦点离开该控件前不呈现于该行——焦点离开后的下一次重拉（写后/清除后/作用域切换任一触发）对齐；写/清除失败的强制回滚对账键是集合（连续多次失败的全部未对账键在真正结算的刷新中统一强制回滚，弃置/异常不消费、留待下一笔结算兜底——审查轮 R2 起单槽语义废止）。
- **按层显示的降级残余（#60 后）**：快照无 `userValues` 字段的旧宿主（vsidian#590 前，含 API 1.1.x/1.2.x 发行宿主）上，scope=user 仍显示合并值 + 徽章 + 合并值提示（mergedHint 过渡形态仅在降级时出现）；新宿主（vsidian#590 起）用户层真值直达。组件 `api` 下界维持 `^1.1.0`——`userValues` 是可选字段，升下界到未发行版本不被允许，降级路径保留至平台下个发行版本成为最低支持面后可随票移除。
- **spacing 卡片不随 autoFormat 总开关联动置灰**：语言间空格策略分区是规则域渲染（rulesUi spacing），与设置行（设置域）渲染分离；联动置灰仅覆盖自动格式化 Tab 的设置行。总开关关闭时 spacing 分区仍可编辑，其生效由引擎侧 autoFormat 总门把守。
- **定位补投以首次 `get` 结算为闸**：get 结算成败皆算（失败时行以默认形态在场）；若通道挂起无响应（promise 永不落定），首开排队目标停留在排队态不投递——组件不为 get 另设超时，也不绕过结算直接投递。
- **facet 缺席 = 降级形态**：旧宿主 / 编辑器页形态下无作用域相关 UI、无定位消费，写入目标层固定 `'user'`；页面其余功能完整可用（`^1.1.0` 下界保证发行宿主恒有 facet，降级形态仅为防御性兼容与测试注入面）。
- **面板隐藏自防与平台 reset 双保险**：`src/settings.css` 对 `.vsidian-easy-typing-settings-tab-panel[hidden]` 显式 `display:none`——面板基线 `display:flex` 会覆盖 UA `[hidden]`，实际隐藏不单靠平台 webview 全局 `[hidden]{display:none!important}` reset（reset 在场时两者一致，reset 缺席时组件自身仍正确隐藏）。
