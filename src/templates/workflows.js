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

/**
 * Bỏ "./" ở đầu và "/" ở cuối để lấy đường dẫn thư mục con sạch.
 * './' hoặc '' -> '' (tức là thư mục gốc của repo).
 */
function cleanWorkingDir(workingDir) {
    return (workingDir || './').replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * Sinh step tạo file .env trên runner từ Github Secret.
 * Trả về '' nếu không có secret (không cần nạp .env).
 * target: đường dẫn file .env tương đối với nơi step `run` thực thi.
 */
function getEnvStep(envSecretName, target = '.env') {
    if (!envSecretName) return '';
    return `
      - name: Tạo file .env từ Github Secret
        env:
          ENV_FILE_CONTENT: \${{ secrets.${envSecretName} }}
        run: |
          printf '%s\\n' "$ENV_FILE_CONTENT" > ${target}
`;
}

function getNodeWorkflow(domain, workingDir, usePrisma, port, envSecretName, isWorkspace) {
    const cleanDir = cleanWorkingDir(workingDir);
    const pm2Name = `app-${domain}`;
    const pm2RestartCmd = `PORT=${port} pm2 restart ${pm2Name} || PORT=${port} pm2 start npm --name "${pm2Name}" -- run start`;

    let prismaCmds = '';
    if (usePrisma) {
        prismaCmds = `
            npx prisma generate
            npx prisma db push --accept-data-loss`;
    }

    if (isWorkspace) {
        // npm workspaces: lockfile chỉ ở gốc -> npm ci phải chạy ở gốc repo.
        // Triển khai cả repo lên VPS, app nằm trong thư mục con.
        const envTarget = cleanDir ? `${cleanDir}/.env` : '.env';
        const envStep = getEnvStep(envSecretName, envTarget);
        const buildCd = cleanDir ? `cd ${cleanDir} && ` : '';
        const vpsRoot = `/var/www/${domain}`;
        const vpsAppDir = cleanDir ? `${vpsRoot}/${cleanDir}` : vpsRoot;

        return `name: Deploy Node.js App (Monorepo Workspace)

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
          node-version: '26'
${envStep}
      - name: Install Dependencies (workspace root)
        run: npm ci

      - name: Build Project
        run: ${buildCd}npm run build --if-present

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
          rsync -avz --delete --exclude '.git' --exclude 'node_modules' ./ $USER@$HOST:${vpsRoot}

      - name: Restart PM2 & Update DB
        uses: appleboy/ssh-action@master
        with:
          host: \${{ secrets.VPS_HOST }}
          username: \${{ secrets.VPS_USERNAME }}
          key: \${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ${vpsRoot}
            npm ci --production
            cd ${vpsAppDir}${prismaCmds}
            ${pm2RestartCmd}
`;
    }

    // Mặc định (không phải workspace): giữ logic cũ + nạp .env.
    const rsyncSrc = workingDir === './' ? './' : `${workingDir}/`;
    const envStep = getEnvStep(envSecretName, '.env');

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
          node-version: '26'
${envStep}
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
            npm ci --production${prismaCmds}
            ${pm2RestartCmd}
`;
}

function getLaravelWorkflow(domain, workingDir, envSecretName, phpVersion) {
    const rsyncSrc = workingDir === './' ? './' : `${workingDir}/`;
    const ver = phpVersion || '8.3';
    // Nạp .env vào thư mục mã nguồn trước khi rsync để file .env được đẩy lên VPS.
    const envStep = getEnvStep(envSecretName, '.env');

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
          php-version: '${ver}'
          extensions: mbstring, xml, ctype, iconv, intl, pdo, pdo_mysql, pdo_pgsql, dom, filter, gd, json, libxml, openssl, pcre, phar, simplexml, tokenizer, xmlwriter, zip, bcmath
${envStep}
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
            test -f .env || cp -n .env.example .env 2>/dev/null || true
            grep -q "^APP_KEY=base64" .env 2>/dev/null || php artisan key:generate --force
            php artisan migrate --force
            php artisan config:cache
            php artisan route:cache
            php artisan view:cache
            sudo chown -R www-data:www-data /var/www/${domain}/storage /var/www/${domain}/bootstrap/cache
`;
}

function getPurePhpWorkflow(domain, workingDir, envSecretName) {
    const rsyncSrc = workingDir === './' ? './' : `${workingDir}/`;
    const envStep = getEnvStep(envSecretName, '.env');

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
${envStep}
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

function getSpaWorkflow(domain, workingDir, buildDir, envSecretName, isWorkspace) {
    const cleanDir = cleanWorkingDir(workingDir);

    if (isWorkspace) {
        // npm workspaces: npm ci ở gốc, build trong thư mục con, chỉ rsync thư mục build.
        const envTarget = cleanDir ? `${cleanDir}/.env` : '.env';
        const envStep = getEnvStep(envSecretName, envTarget);
        const buildCd = cleanDir ? `cd ${cleanDir} && ` : '';
        const distPath = cleanDir ? `${cleanDir}/${buildDir}/` : `${buildDir}/`;

        return `name: Deploy SPA (React/Vite/Vue) - Monorepo Workspace

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
          node-version: '26'
${envStep}
      - name: Install Dependencies (workspace root)
        run: npm ci

      - name: Build Project
        run: ${buildCd}npm run build

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
          rsync -avz --delete --exclude '.git' ${distPath} $USER@$HOST:/var/www/${domain}
`;
    }

    let rsyncSrc = workingDir === './' ? './' : `${workingDir}/`;
    rsyncSrc = path.posix.join(rsyncSrc, buildDir, '/'); // e.g., ./dist/ hoặc ./frontend/dist/
    // Nạp .env trước khi build để Vite/CRA đọc được biến VITE_* / REACT_APP_* lúc build.
    const envStep = getEnvStep(envSecretName, '.env');

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
          node-version: '26'
${envStep}
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
 * Sinh file .github/workflows/deploy*.yml
 * options: { projectType, domain, role, workingDir, buildDir, usePrisma, port,
 *            envSecretName, isWorkspace, phpVersion }
 */
export function generateWorkflowFile(options) {
    const {
        projectType,
        domain,
        role,
        workingDir,
        buildDir,
        usePrisma,
        port,
        envSecretName,
        isWorkspace,
        phpVersion
    } = options;

    const workflowsDir = path.join(process.cwd(), '.github', 'workflows');

    if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
    }

    let workflowContent = '';
    if (projectType.includes('Node.js')) {
        workflowContent = getNodeWorkflow(domain, workingDir, usePrisma, port, envSecretName, isWorkspace);
    } else if (projectType === 'PHP (Laravel)') {
        workflowContent = getLaravelWorkflow(domain, workingDir, envSecretName, phpVersion);
    } else if (projectType === 'PHP (Thuần)') {
        workflowContent = getPurePhpWorkflow(domain, workingDir, envSecretName);
    } else if (projectType === 'React/Vite/Vue (SPA)') {
        workflowContent = getSpaWorkflow(domain, workingDir, buildDir, envSecretName, isWorkspace);
    } else {
        workflowContent = getStaticWorkflow(domain, workingDir);
    }

    // Đặt tên file dựa trên role
    const fileName = role === 'Fullstack (Gốc)' ? 'deploy.yml' : `deploy-${role.toLowerCase()}.yml`;
    const workflowPath = path.join(workflowsDir, fileName);

    fs.writeFileSync(workflowPath, workflowContent);
    console.log(`Đã tạo file workflow tại: ${workflowPath}`);
}
