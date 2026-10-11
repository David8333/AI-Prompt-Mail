# MailForge — 高級郵件草稿快速生成工具

基於 **Vite + React + TypeScript + Tailwind CSS** 建構的模組化郵件範本管理與動態變數填空系統，支援純靜態無伺服器部署（GitHub + Vercel 一鍵發佈）。

## 功能特色

- **全裝置 RWD 響應式介面**：桌面端三欄式工作區，平板與手機端自動切換為分段標籤導覽。
- **自訂範本管理**：支援新增空白範本、引導建立範本、修改固定文字、釘選常用、複製副本、個別儲存與刪除，資料自動持久化於瀏覽器 `localStorage`。
- **自訂變數框管理**：支援自由新增與刪除常用 `[變數名稱]` 標籤、點擊插入至主旨或內文游標位置，或反白選取文字一鍵轉換為變數框。
- **即時預覽與一鍵複製**：填寫變數時即時渲染完整信件，支援獨立「複製主旨」、「複製內文」、「複製完整郵件」與直接開啟系統預設郵件軟體 (`mailto:`)。
- **JSON 備份匯入與匯出**：支援將所有範本與變數資料打包下載為 `.json` 檔案，或上傳備份檔進行合併／覆蓋還原。

---

## 專案檔案結構

```text
├── index.html                  # 網頁入口與字型設定
├── package.json                # 專案依賴與打包指令 (build / dev / preview)
├── vite.config.ts              # Vite 建構與輸出目錄 (dist) 設定
├── tailwind.config.js          # Tailwind CSS 設定檔
├── tsconfig.json               # TypeScript 編譯設定
├── vercel.json                 # Vercel 自動化部署與 SPA 路由設定
└── src/
    ├── main.tsx                # React 掛載入口
    ├── index.css               # 全域樣式與 Tailwind 載入
    ├── App.tsx                 # 主應用程式介面與狀態管理
    ├── types/
    │   └── template.ts         # 範本、變數與 JSON 備份型別定義
    ├── data/
    │   └── defaultTemplates.ts # 預設範本庫與預設變數標籤
    └── utils/
        └── templateParser.ts   # 變數解析、替換與即時預覽分段工具
```

---

## 如何上傳至 GitHub 並部署至 Vercel

### 步驟 1：上傳程式碼至 GitHub

1. 在 AI Studio 右上角點擊下載專案壓縮檔（或直接同步至 GitHub），解壓縮至本機資料夾。
2. 在 GitHub 建立一個新的 Repository（例如 `mailforge-email-studio`）。
3. 在專案資料夾開啟終端機，依序執行：

```bash
git init
git add .
git commit -m "Initial commit: MailForge Email Draft Studio"
git branch -M main
git remote add origin https://github.com/<您的GitHub帳號>/<您的Repo名稱>.git
git push -u origin main
```

### 步驟 2：連接 Vercel 自動部署

1. 前往 [Vercel 官網](https://vercel.com/) 並使用 GitHub 帳號登入。
2. 點擊 **Add New...** ➔ **Project**。
3. 選擇您剛建立的 GitHub Repository 並點擊 **Import**。
4. 專案內已內建 `vercel.json`，Vercel 會自動帶入以下設定（無須手動修改）：
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. 點擊 **Deploy**，約 30 秒即可完成部署並取得正式網址！之後只要推送更新至 GitHub `main` 分支，Vercel 就會自動重新編譯發佈。

---

## 本機開發指令

```bash
# 1. 安裝套件
npm install

# 2. 啟動本機開發伺服器 (http://localhost:3000)
npm run dev

# 3. 打包正式環境靜態檔案 (輸出至 dist/ 資料夾)
npm run build

# 4. 預覽打包結果
npm run preview
```
