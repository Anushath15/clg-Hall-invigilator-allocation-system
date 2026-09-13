# Exam Invigilator Allocation System (EIAS)

A desktop application designed for automated, fair, and efficient examination hall invigilator allocation for educational institutions (SXCCE).

## 📌 Features
- **Automated Invigilator Allocation**: Intelligent allocation of faculty members to exam halls based on constraints and availability.
- **Role-based Authentication**: Secure access for administrators and faculty.
- **Reporting & Export**: Generate allocation schedules, seating charts, and export to PDF/Excel.
- **Desktop Application**: Built with Electron, Vite, and React for a modern, cross-platform experience.

## 📁 Repository Structure
```
Mini Project/
├── Exam_Hall_Allocation_Workflow.docx  # System workflow & requirement documentation
├── eias/                               # Electron + React application source code
│   ├── src/
│   │   ├── main/                       # Electron main process & SQLite DB operations
│   │   ├── preload/                    # Secure IPC bridge
│   │   └── renderer/                   # React frontend UI (Tailwind CSS, Lucide icons)
│   ├── package.json
│   ├── electron.vite.config.ts
│   └── ...
└── .gitignore
```

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm` or `yarn`

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Anushath15/clg-Hall-invigilator-allocation-system.git
   ```
2. Navigate into the application directory:
   ```bash
   cd "clg-Hall-invigilator-allocation-system/eias"
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

### Development
Start the application in development mode:
```bash
npm run dev
```

### Build & Packaging
- Compile project:
  ```bash
  npm run build
  ```
- Package desktop installer for Windows:
  ```bash
  npm run package
  ```

## 📄 License
This project is licensed under the MIT License.
