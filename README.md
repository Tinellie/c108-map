项目概览
========

这是一个「圈子收藏抓取 + 地图抽取 + 地图编辑 + 前端查看」的一体化项目。
核心目标是把多个来源的数据，统一成可查询、可编辑、可展示的地图与圈子资料。

数据来源（明确枚举）
-------------------

1. 收藏列表网页（circle.ms 收藏页）
  - 输入类型：HTML。
  - 进入组件：scrapeService（Puppeteer）。
  - 产出：圈子基础字段（circle_id、社团名、摊位、颜色、详情页 URL、图片 URL 列表）。
  - 后续存储：MySQL.favorite_circles、storage/images/circle。

2. 圈子详情网页（detail_url）
  - 输入类型：HTML。
  - 进入组件：circleDetailService。
  - 产出：author_name、pixiv_id、twitter_id、tags_text、supplement_text。
  - 后续存储：MySQL.favorite_circles。

3. 地图 PDF（默认 storage/map.pdf）
  - 输入类型：PDF。
  - 进入组件：mapExtractionService -> Python 脚本 extract_map_booths.py。
  - 产出：summary.json、分页页面 JSON、booth/实体信息。
  - 后续存储：storage/map_extracted。

4. OSM 文件（storage/osm 下 .osm）
  - 输入类型：OSM XML 文本。
  - 进入组件：/api/osm/files、/api/osm/file，viewer 的 OSM 页面。
  - 产出：前端可渲染道路/区域/标签数据。
  - 后续存储：原文件仍在 storage/osm。

5. 地图编辑快照（map editor snapshot）
  - 输入类型：JSON（pages + summary）。
  - 进入组件：/api/map/editor-snapshots*、mapEditorSnapshotService。
  - 产出：按 saveId 版本化页面快照、meta、分页 page-*.json。
  - 后续存储：storage/map_extracted/edits/<saveId>。

6. 颜色偏好输入（前端拖拽排序 + 别名）
  - 输入类型：JSON items[]。
  - 进入组件：PUT /api/color-preferences、colorPreferenceRepository。
  - 产出：更新后的 sort_priority 与 alias_name。
  - 后续存储：MySQL.color_palettes。

组件与子功能（逐项）
-------------------

1) viewer-app（前端）

1. /viewer（CirclesViewerPage）
  - 子功能：加载圈子列表、关键字搜索、按日期/会场筛选、排序切换、分页、详情抽屉、颜色优先级编辑、颜色别名保存。
  - 输入：
    - GET /api/favorite-circles（JSON 列表 + 分页）。
    - GET /api/color-preferences（JSON 别名与优先级）。
  - 输出：
    - 页面表格与统计。
    - PUT /api/color-preferences 请求体 {items:[{color_index,sort_priority,alias_name}]}。
  - 读写存储：读取 MySQL.favorite_circles、MySQL.color_palettes；写入 MySQL.color_palettes。
  - 操作数据：圈子展示字段、颜色排序字段。

2. /crawler（CrawlRunnerPage）
  - 子功能：读取爬虫可选参数、启动任务、轮询当前任务、查看历史任务。
  - 输入：GET /api/crawl/options、GET /api/crawl/jobs/current、GET /api/crawl/jobs。
  - 输出：POST /api/crawl/jobs（profile、headless、crawlMode）。
  - 读写存储：任务状态在服务内存中；任务运行后写 MySQL 与 storage/images。
  - 操作数据：爬虫任务请求参数、任务摘要统计。

3. /osm-canvas（OsmCanvasPage）
  - 子功能：列出 OSM 文件、加载单个 OSM 文本、在画布渲染线段/区域。
  - 输入：GET /api/osm/files、GET /api/osm/file?path=...。
  - 输出：前端画布渲染结果（无后端写入）。
  - 读写存储：只读 storage/osm。
  - 操作数据：OSM way/node/tag 的前端解析结构。

4. /osm-map（OsmMapPage）
  - 子功能：OSM 地图显示、层级过滤、路径高亮、用户模式切换、叠加编辑器快照实体、圈子联动抽屉。
  - 输入：
    - GET /api/osm/file。
    - GET /api/map/editor-snapshots/latest。
    - GET /api/favorite-circles。
  - 输出：可选 PUT /api/map/editor-snapshots/overlay-transforms（叠加参数保存）。
  - 读写存储：读 storage/osm、storage/map、MySQL.favorite_circles；写 storage/map/overlay-transforms.json。
  - 操作数据：OSM 几何、overlay transform、实体标签与圈子映射。

5. /map-editor（MapEditorPage）
  - 子功能：加载抽取结果、框选/移动/旋转实体、编号规则应用、尺寸校正、快照保存、快照回退、快照转存到 storage/map。
  - 输入：GET /api/map/extraction、GET /api/map/editor-snapshots/latest、GET /api/map/editor-snapshots/previous。
  - 输出：
    - POST /api/map/editor-snapshots。
    - POST /api/map/editor-snapshots/transfer。
    - POST /api/map/extraction（重跑抽取）。
  - 读写存储：读 storage/map_extracted；写 storage/map_extracted/edits 与 storage/map。
  - 操作数据：page.entities（booths/groups/islands/halls）、summary 元数据。

6. /map-editor/convert-data（ConvertDataPage）
  - 子功能：读取 latest snapshot，勾选页面，设置输出编号。
  - 输入：GET /api/map/editor-snapshots/latest。
  - 输出：当前仅前端状态提示，转换提交尚未实现。
  - 读写存储：只读 storage/map_extracted/edits（经 API）。
  - 操作数据：snapshot.pages 的页面清单与启用状态。

2) API 服务（src/api/server.js）

通用行为
- 输入类型：HTTP JSON / Query / Path 参数。
- 输出类型：JSON（成功 {data:...} 或错误 {message:...}）。
- 静态资源：/storage/* 直接映射到本地 storage 目录。

接口清单（方法、用途、输入、输出、存储、操作数据）

1. GET /api/health
  - 用途：数据库健康检查。
  - 输入：无。
  - 输出：{ok:true|false}。
  - 存储：只读 MySQL 连接状态。
  - 操作数据：连接可用性。

2. GET /api/crawl/options
  - 用途：返回爬虫 UI 所需选项。
  - 输入：无。
  - 输出：defaultUrl、profiles、crawlModes 等 JSON。
  - 存储：不读写数据库。
  - 操作数据：任务参数元信息。

3. POST /api/crawl/jobs
  - 用途：启动抓取任务。
  - 输入：{profile, headless, crawlMode}。
  - 输出：202 + job 信息；冲突返回 409。
  - 存储：运行后写 MySQL.favorite_circles、storage/images/circle。
  - 操作数据：圈子列表、详情字段、图片文件。

4. GET /api/crawl/jobs/current
  - 用途：查询当前任务。
  - 输入：无。
  - 输出：{data: job|null}。
  - 存储：只读内存任务对象。
  - 操作数据：任务状态与摘要。

5. GET /api/crawl/jobs
  - 用途：查询任务历史。
  - 输入：limit。
  - 输出：job 数组。
  - 存储：只读内存历史队列。
  - 操作数据：任务摘要。

6. GET /api/crawl/jobs/:jobId
  - 用途：查询单任务。
  - 输入：jobId。
  - 输出：job 或 404。
  - 存储：只读内存对象。
  - 操作数据：单任务详情。

7. GET /api/color-preferences
  - 用途：读取颜色排序与别名。
  - 输入：无。
  - 输出：[{color_index,sort_priority,alias_name}]。
  - 存储：读 MySQL.color_palettes。
  - 操作数据：颜色偏好。

8. PUT /api/color-preferences
  - 用途：保存颜色排序与别名。
  - 输入：{items:[{color_index,sort_priority,alias_name}]}。
  - 输出：更新后的完整偏好数组。
  - 存储：写 MySQL.color_palettes。
  - 操作数据：sort_priority、color_name。

9. GET /api/map/extraction
  - 用途：读取抽取摘要。
  - 输入：无。
  - 输出：summary.json 的 data。
  - 存储：读 storage/map_extracted/summary.json。
  - 操作数据：页数、booth 数、pages 结构。

10. POST /api/map/extraction
   - 用途：执行地图抽取（Python）。
   - 输入：无（使用配置中的 pdfPath/outputDir/dpi）。
   - 输出：新 summary。
   - 存储：写 storage/map_extracted。
   - 操作数据：PDF -> 页面 JSON/渲染/摘要。

11. GET /api/map/editor-snapshots
   - 用途：列出快照元数据。
   - 输入：limit。
   - 输出：[{saveId,createdAt,pageCount,totalBooths,...}]。
   - 存储：读 storage/map_extracted/edits/*/meta.json。
   - 操作数据：快照索引信息。

12. GET /api/map/editor-snapshots/latest
   - 用途：读取最新快照（含 pages）。
   - 输入：无。
   - 输出：snapshot 对象。
   - 存储：读 storage/map_extracted/edits。
   - 操作数据：完整页面实体。

13. GET /api/map/editor-snapshots/previous?saveId=...
   - 用途：读取某快照的上一版。
   - 输入：saveId。
   - 输出：snapshot 或 404。
   - 存储：读 storage/map_extracted/edits。
   - 操作数据：版本回退对象。

14. GET /api/map/editor-snapshots/:saveId
   - 用途：读取指定快照。
   - 输入：saveId。
   - 输出：snapshot。
   - 存储：读 storage/map_extracted/edits/<saveId>。
   - 操作数据：pages + summaryMeta。

15. POST /api/map/editor-snapshots
   - 用途：保存快照。
   - 输入：{pages,summary}。
   - 输出：meta（saveId/pageCount/totalBooths/pageFiles）。
   - 存储：写 storage/map_extracted/edits/<saveId>/meta.json 与 pages/page-*.json。
   - 操作数据：编辑后的实体、渲染图路径、统计。

16. POST /api/map/editor-snapshots/transfer
   - 用途：保存快照后转存到 storage/map（覆盖式）。
   - 输入：{pages,summary}。
   - 输出：snapshot + transfer.targetPath。
   - 存储：写 storage/map_extracted/edits，并复制到 storage/map。
   - 操作数据：用于 viewer 的当前生效地图数据。

17. GET /api/map/editor-snapshots/overlay-transforms
   - 用途：读取 OSM 叠加参数。
   - 输入：无。
  - 输出：{pageOverlays,pageHalls,pageIslandLabelSettings}。
   - 存储：读 storage/map/overlay-transforms.json。
   - 操作数据：叠加平移/缩放/标注配置。

18. PUT /api/map/editor-snapshots/overlay-transforms
   - 用途：保存 OSM 叠加参数。
   - 输入：overlay JSON 对象。
   - 输出：原样回传 data。
   - 存储：写 storage/map/overlay-transforms.json。
   - 操作数据：前端叠加定位参数。

19. GET /api/map/pages
   - 用途：列出已转存页面。
   - 输入：无。
   - 输出：[{page,pageFile,label}]。
   - 存储：读 storage/map/meta.json。
   - 操作数据：页面索引。

20. GET /api/map/pages/:page
   - 用途：读取单页地图 JSON。
   - 输入：page 路径参数。
   - 输出：page-<n>.json 内容。
   - 存储：读 storage/map/pages/page-<n>.json。
   - 操作数据：单页实体。

21. GET /api/osm/files
   - 用途：递归列出所有 .osm 文件。
   - 输入：无。
   - 输出：[{path,label}]。
   - 存储：读 storage/osm。
   - 操作数据：OSM 文件清单。

22. GET /api/osm/file?path=...
   - 用途：读取指定 OSM 文件文本。
   - 输入：query.path（相对路径，且必须 .osm）。
   - 输出：{path,content}。
   - 存储：读 storage/osm/<path>。
   - 操作数据：OSM XML 内容。

23. GET /api/favorite-circles
   - 用途：圈子列表与搜索。
   - 输入：q、limit、page、offset。
   - 输出：data[] + pagination，含 local_image_urls。
   - 存储：读 MySQL.favorite_circles。
   - 操作数据：圈子主记录与图片路径 JSON。

24. GET /api/favorite-circles/:circleId
   - 用途：圈子详情。
   - 输入：circleId。
   - 输出：单条圈子记录（含 local_image_paths/local_image_urls）。
   - 存储：读 MySQL.favorite_circles。
   - 操作数据：圈子全部字段。

25. GET /api/favorite-circles/:circleId/images
   - 用途：仅返回圈子图片集合。
   - 输入：circleId。
   - 输出：{circle_id,local_image_paths,local_image_urls}。
   - 存储：读 MySQL.favorite_circles + /storage 静态映射。
   - 操作数据：图片路径数组。

3) 抓取与处理流水线（backend services/repositories）

1. crawlJobService
  - 子功能：参数校验、任务互斥（同一时刻仅 1 个）、生成 jobId、维护 current/history、返回任务摘要。
  - 输入：profile/headless/crawlMode。
  - 输出：任务状态对象。
  - 存储：内存任务队列，间接触发 DB/文件写入。
  - 操作数据：任务生命周期数据。

2. crawlPipeline
  - 子功能：
    - ensureSchema。
    - 加载 existing circle id。
    - 加载颜色映射。
    - 翻页抓取列表。
    - 依据 crawlMode 决定 list 写入范围和 detail 抓取范围。
    - 下载图片。
    - upsert 列表字段。
    - 抓取 detail 并回写。
  - 输入：列表页 HTML、详情页 HTML、图片 URL。
  - 输出：summary（总页数/新增数/下载数/变化数）。
  - 存储：MySQL.favorite_circles、storage/images/circle。
  - 操作数据：圈子记录、图片文件、统计指标。

3. scrapeService
  - 子功能：启动/连接浏览器、手动登录等待、按 profile 提取字段、翻页（last/previous/next）、回收 cookies。
  - 输入：网页 DOM、profile 选择器/提取器。
  - 输出：rawItems[]、cookies、当前 URL、title。
  - 存储：不直接写存储。
  - 操作数据：网页结构化中间数据。

4. imageDownloadService
  - 子功能：图片 URL 归一化、按 circle_id 建目录、缺失才下载、写本地文件、回填 local_image_paths。
  - 输入：circle.source_images[]、cookies、referer。
  - 输出：{downloaded,skipped}，并修改 circle.local_image_paths。
  - 存储：写 storage/images/circle/<circle_id>/*.png。
  - 操作数据：二进制图片与路径数组。

5. crawlRepository
  - 子功能：
    - loadExistingCircleIdSet。
    - upsertFavoriteCircles（列表字段 + local_image_paths_json）。
    - upsertCircleDetails（作者/社媒/标签补全）。
  - 输入：圈子数组、详情数组。
  - 输出：数据库事务写入结果。
  - 存储：写 MySQL.favorite_circles。
  - 操作数据：圈子主字段、详情字段、图片路径 JSON。

6. colorPreferenceRepository
  - 子功能：读取颜色偏好、校验唯一性、两阶段更新 sort_priority 防冲突、写别名。
  - 输入：items[{color_index,sort_priority,alias_name}]。
  - 输出：更新后的偏好记录。
  - 存储：读写 MySQL.color_palettes。
  - 操作数据：颜色排序与名称。

4) 地图抽取与快照组件

1. mapExtractionService
  - 子功能：解析抽取配置、调用 Python 脚本、读取 summary、判断 summary 是否存在。
  - 输入：PDF 路径、输出目录、DPI。
  - 输出：summary JSON。
  - 存储：读写 storage/map_extracted。
  - 操作数据：页级 booth 统计与结构。

2. mapEditorSnapshotService
  - 子功能：
    - 规范化页面/实体数据。
    - 保存快照（saveId + pages + meta）。
    - 列表/读取/latest/previous。
    - transfer 到 storage/map（覆盖旧内容）。
  - 输入：pages[]、summary。
  - 输出：snapshot meta、完整 snapshot、transfer 结果。
  - 存储：storage/map_extracted/edits、storage/map。
  - 操作数据：booths/groups/islands/halls、渲染尺寸、标签设置。

5) 数据库与文件存储

数据库表

1. color_palettes
  - 类型：MySQL 表。
  - 关键字段：color_index(PK)、bg_color、color_name、sort_priority(unique)。
  - 读写组件：colorPreferenceRepository、colorPaletteRepository。

2. favorite_circles
  - 类型：MySQL 表。
  - 关键字段：circle_id(unique)、circle_name、booth_location、color_index、author_name、pixiv_id、twitter_id、tags_text、supplement_text、local_image_paths_json、updated_at。
  - 读写组件：crawlRepository、/api/favorite-circles*。

文件目录

1. storage/images/circle
  - 类型：PNG/JPG 文件。
  - 写入组件：imageDownloadService。
  - 读取组件：/storage 静态服务、favorite-circles API。

2. storage/map_extracted
  - 类型：summary.json、分页 JSON、调试与渲染产物。
  - 写入组件：mapExtractionService。
  - 读取组件：/api/map/extraction、MapEditorPage。

3. storage/map_extracted/edits
  - 类型：按 saveId 的 meta.json + pages/page-*.json。
  - 写入组件：mapEditorSnapshotService。
  - 读取组件：/api/map/editor-snapshots*。

4. storage/map
  - 类型：当前生效地图快照（meta/page 文件）与 overlay-transforms.json。
  - 写入组件：snapshot transfer、overlay transform 保存。
  - 读取组件：/api/map/pages*、/api/map/editor-snapshots/overlay-transforms。

5. storage/osm
  - 类型：.osm XML 文件。
  - 写入方式：人工放置或外部流程产出。
  - 读取组件：/api/osm/files、/api/osm/file、OsmCanvasPage、OsmMapPage。

端到端数据流（简化但精确）
-------------------------

1. 爬虫入口：/crawler -> POST /api/crawl/jobs。
2. scrapeService 抓列表页 HTML -> 结构化圈子数据。
3. imageDownloadService 下载 source_images -> storage/images/circle。
4. crawlRepository upsert 到 MySQL.favorite_circles。
5. 可选 detail 抓取 -> 更新 author/tags/social 字段。
6. /viewer 读取圈子与颜色偏好，支持筛选排序与详情查看。
7. 地图侧：POST /api/map/extraction 从 PDF 生成 storage/map_extracted。
8. /map-editor 编辑 entities -> POST /api/map/editor-snapshots 保存版本。
9. transfer 后写入 storage/map，/map 与 /osm-map 读取生效数据。
