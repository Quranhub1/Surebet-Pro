# SurebetPro - Local Setup Guide

If the cloud preview environment is experiencing connection instability, the most reliable way to run and inspect the system at full performance is to run it locally on your computer.

The project includes the connected database integration and the ready-to-run arbitrage engine. Follow the steps below:

## Prerequisites

1. Install [Node.js](https://nodejs.org/) version 18 or higher.
2. Install a code editor such as [VS Code](https://code.visualstudio.com/).

## Step-by-Step

1. **Download the Project:**
   - Clone or download the project repository.
   - If you downloaded a ZIP file, extract it to a folder on your computer.

2. **Open the Project in a Terminal:**
   - Open the extracted project folder in VS Code.
   - Open the integrated VS Code terminal (`Ctrl + \`` or `Cmd + \``).

3. **Install Dependencies:**
   Run the command below to install the project libraries (React, Tailwind, Supabase, and others):
   ```bash
   yarn install
   ```
   *(If Yarn is not installed, you can use `npm install` instead.)*

4. **Start the Complete System:**
   To run the visual dashboard (Frontend) and the scanning engine (Backend) together, run:
   ```bash
   yarn run dev:all
   ```

5. **Open the Application:**
   Open your browser (Chrome, Edge, or Safari) and go to:
   **http://localhost:5173**

The SurebetPro system should now be running locally without depending on the cloud preview environment.
