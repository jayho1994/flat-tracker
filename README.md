# 睇樓資料庫（flat-tracker）v2.0

Jay 與太太共用的租樓決策工具：GitHub Pages PWA（兩部電話同一網址）＋ AWS Lambda ＋ Notion（六個 database）＋ Claude 分析。

```
docs/index.html     前端 PWA（GitHub Pages 由 /docs 發佈）
lambda/index.mjs    Notion 代理 + 28Hse 抓取 + Claude 分析（Node.js 20，Function URL）
手冊.md             逐步部署與使用手冊（請先讀）
```

功能：管線看板（網上見到→已簽約）、貼網址自動抓樓盤資料、同座同號自動套用、房間量度、傢俬配對（地面／入門）、25 項檢查表（夫妻各一份）、出價與要求記錄、代理管理、預算與退租日警示、排序／篩選、並排對比、AI 摘要／相片檢查／AI 比較、離線佇列與 45 秒輪詢同步。

已知限制：網頁無法用 iPhone LiDAR（用內置測距儀量度後輸入）；樓盤網抓取視乎對方是否封鎖；兩人同時改同一欄位後寫者勝。
