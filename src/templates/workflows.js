import fs from 'fs';
import path from 'path';

function getNodeWorkflow() {
    return `name: Deploy Node.js App

on:
  push:
    branches:
      - main
      - master

jobs:
  deploy:
    runs-on: ubuntu-latest
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
          rsync -avz --delete --exclude '.git' --exclude 'node_modules' ./ $USER@$HOST:/var/www/my-app

      - name: Restart PM2
        uses: appleboy/ssh-action@master
        with:
          host: \${{ secrets.VPS_HOST }}
          username: \${{ secrets.VPS_USERNAME }}
          key: \${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /var/www/my-app
            npm ci --production
            pm2 restart app || pm2 start npm --name "app" -- run start
`;
}

function getLaravelWorkflow(domain) {
    return `name: Deploy Laravel App

on:
  push:
    branches:
      - main
      - master

jobs:
  deploy:
    runs-on: ubuntu-latest
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
          rsync -avz --delete --exclude '.git' --exclude 'storage/logs' ./ $USER@$HOST:/var/www/${domain}

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

function getStaticWorkflow(domain) {
    return `name: Deploy Static Website

on:
  push:
    branches:
      - main
      - master

jobs:
  deploy:
    runs-on: ubuntu-latest
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
          rsync -avz --delete --exclude '.git' ./ $USER@$HOST:/var/www/${domain}
`;
}

/**
 * Sinh file .github/workflows/deploy.yml
 */
export function generateWorkflowFile(projectType, domain) {
    const workflowsDir = path.join(process.cwd(), '.github', 'workflows');
    
    // Tạo thư mục nếu chưa có
    if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
    }

    let workflowContent = '';
    if (projectType === 'Node.js (PM2)') {
        workflowContent = getNodeWorkflow();
        // Cập nhật lại đường dẫn cho Node.js app
        workflowContent = workflowContent.replace(/my-app/g, domain);
    } else if (projectType === 'PHP (Laravel)') {
        workflowContent = getLaravelWorkflow(domain);
    } else {
        workflowContent = getStaticWorkflow(domain);
    }

    const workflowPath = path.join(workflowsDir, 'deploy.yml');
    fs.writeFileSync(workflowPath, workflowContent);
    console.log(`Đã tạo file workflow tại: ${workflowPath}`);
}
