import fs from 'fs';
import path from 'path';

function getWorkingDirConfig(workingDir) {
    if (workingDir && workingDir !== './') {
        return `
    defaults:
      run:
        working-directory: ${workingDir}`;
    }
    return '';
}

function getNodeWorkflow(domain, workingDir, usePrisma) {
    const rsyncSrc = workingDir === './' ? './' : `${workingDir}/`;
    const pm2RestartCmd = `pm2 restart app || pm2 start npm --name "app" -- run start`;
    
    let dbCmds = '';
    if (usePrisma) {
        dbCmds = `
            npx prisma generate
            npx prisma db push --accept-data-loss`;
    }

    return `name: Deploy Node.js App

on:
  push:
    branches:
      - main
      - master

jobs:
  deploy:
    runs-on: ubuntu-latest${getWorkingDirConfig(workingDir)}
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install Dependencies
        run: npm ci

      - name: Build Project
        run: npm run build --if-present

      - name: Copy files to VPS via rsync
        env:
          SSH_KEY: \${{ secrets.VPS_SSH_KEY }}
          HOST: \${{ secrets.VPS_HOST }}
          USER: \${{ secrets.VPS_USERNAME }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan -H $HOST >> ~/.ssh/known_hosts
          rsync -avz --delete --exclude '.git' --exclude 'node_modules' ${rsyncSrc} $USER@$HOST:/var/www/${domain}

      - name: Restart PM2 & Update DB
        uses: appleboy/ssh-action@master
        with:
          host: \${{ secrets.VPS_HOST }}
          username: \${{ secrets.VPS_USERNAME }}
          key: \${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /var/www/${domain}
            npm ci --production${dbCmds}
            ${pm2RestartCmd}
`;
}

function getLaravelWorkflow(domain, workingDir) {
    const rsyncSrc = workingDir === './' ? './' : `${workingDir}/`;
    return `name: Deploy Laravel App

on:
  push:
    branches:
      - main
      - master

jobs:
  deploy:
    runs-on: ubuntu-latest${getWorkingDirConfig(workingDir)}
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.1'
          extensions: mbstring, xml, ctype, iconv, intl, pdo_sqlite, dom, filter, gd, iconv, json, libxml, mbstring, openssl, pcre, phar, simplexml, tokenizer, xml, xmlwriter, zip

      - name: Install Dependencies
        run: composer install --no-interaction --prefer-dist --optimize-autoloader

      - name: Copy files to VPS via rsync
        env:
          SSH_KEY: \${{ secrets.VPS_SSH_KEY }}
          HOST: \${{ secrets.VPS_HOST }}
          USER: \${{ secrets.VPS_USERNAME }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan -H $HOST >> ~/.ssh/known_hosts
          rsync -avz --delete --exclude '.git' --exclude 'storage/logs' ${rsyncSrc} $USER@$HOST:/var/www/${domain}

      - name: Run Migrations & Cache
        uses: appleboy/ssh-action@master
        with:
          host: \${{ secrets.VPS_HOST }}
          username: \${{ secrets.VPS_USERNAME }}
          key: \${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /var/www/${domain}
            php artisan migrate --force
            php artisan config:cache
            php artisan route:cache
            php artisan view:cache
            sudo chown -R www-data:www-data /var/www/${domain}/storage /var/www/${domain}/bootstrap/cache
`;
}

function getPurePhpWorkflow(domain, workingDir) {
    const rsyncSrc = workingDir === './' ? './' : `${workingDir}/`;
    return `name: Deploy PHP App

on:
  push:
    branches:
      - main
      - master

jobs:
  deploy:
    runs-on: ubuntu-latest${getWorkingDirConfig(workingDir)}
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Copy files to VPS via rsync
        env:
          SSH_KEY: \${{ secrets.VPS_SSH_KEY }}
          HOST: \${{ secrets.VPS_HOST }}
          USER: \${{ secrets.VPS_USERNAME }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan -H $HOST >> ~/.ssh/known_hosts
          rsync -avz --delete --exclude '.git' ${rsyncSrc} $USER@$HOST:/var/www/${domain}
`;
}

function getSpaWorkflow(domain, workingDir, buildDir) {
    let rsyncSrc = workingDir === './' ? './' : `${workingDir}/`;
    rsyncSrc = path.posix.join(rsyncSrc, buildDir, '/'); // e.g., ./dist/ or ./frontend/dist/

    return `name: Deploy SPA (React/Vite/Vue)

on:
  push:
    branches:
      - main
      - master

jobs:
  deploy:
    runs-on: ubuntu-latest${getWorkingDirConfig(workingDir)}
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install Dependencies
        run: npm ci

      - name: Build Project
        run: npm run build

      - name: Copy files to VPS via rsync
        env:
          SSH_KEY: \${{ secrets.VPS_SSH_KEY }}
          HOST: \${{ secrets.VPS_HOST }}
          USER: \${{ secrets.VPS_USERNAME }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan -H $HOST >> ~/.ssh/known_hosts
          rsync -avz --delete --exclude '.git' ${rsyncSrc} $USER@$HOST:/var/www/${domain}
`;
}

function getStaticWorkflow(domain, workingDir) {
    const rsyncSrc = workingDir === './' ? './' : `${workingDir}/`;
    return `name: Deploy Static Website

on:
  push:
    branches:
      - main
      - master

jobs:
  deploy:
    runs-on: ubuntu-latest${getWorkingDirConfig(workingDir)}
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Copy files to VPS via rsync
        env:
          SSH_KEY: \${{ secrets.VPS_SSH_KEY }}
          HOST: \${{ secrets.VPS_HOST }}
          USER: \${{ secrets.VPS_USERNAME }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan -H $HOST >> ~/.ssh/known_hosts
          rsync -avz --delete --exclude '.git' ${rsyncSrc} $USER@$HOST:/var/www/${domain}
`;
}

/**
 * Sinh file .github/workflows/deploy.yml
 */
export function generateWorkflowFile(projectType, domain, role, workingDir, buildDir, usePrisma) {
    const workflowsDir = path.join(process.cwd(), '.github', 'workflows');
    
    if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
    }

    let workflowContent = '';
    if (projectType.includes('Node.js')) {
        workflowContent = getNodeWorkflow(domain, workingDir, usePrisma);
    } else if (projectType === 'PHP (Laravel)') {
        workflowContent = getLaravelWorkflow(domain, workingDir);
    } else if (projectType === 'PHP (Thuần)') {
        workflowContent = getPurePhpWorkflow(domain, workingDir);
    } else if (projectType === 'React/Vite/Vue (SPA)') {
        workflowContent = getSpaWorkflow(domain, workingDir, buildDir);
    } else {
        workflowContent = getStaticWorkflow(domain, workingDir);
    }

    // Đặt tên file dựa trên role
    const fileName = role === 'Fullstack (Gốc)' ? 'deploy.yml' : `deploy-${role.toLowerCase()}.yml`;
    const workflowPath = path.join(workflowsDir, fileName);
    
    fs.writeFileSync(workflowPath, workflowContent);
    console.log(`Đã tạo file workflow tại: ${workflowPath}`);
}
