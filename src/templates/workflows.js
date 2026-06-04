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
 * Trả về các câu lệnh tương ứng với từng package manager (npm/pnpm/yarn).
 */
function pmCommands(packageManager) {
    const pm = packageManager || 'npm';
    if (pm === 'pnpm') {
        return {
            pm: 'pnpm',
            needCorepack: true,
            ci: 'pnpm install --frozen-lockfile',
            prod: 'pnpm install --prod --frozen-lockfile',
            run: (s) => `pnpm run ${s}`,
            pm2Bin: 'pnpm',
            pm2Args: (s) => `run ${s}`
        };
    }
    if (pm === 'yarn') {
        return {
            pm: 'yarn',
            needCorepack: true,
            ci: 'yarn install --frozen-lockfile',
            prod: 'yarn install --production',
            run: (s) => `yarn ${s}`,
            pm2Bin: 'yarn',
            pm2Args: (s) => `${s}`
        };
    }
    return {
        pm: 'npm',
        needCorepack: false,
        ci: 'npm ci',
        prod: 'npm ci --production',
        run: (s) => `npm run ${s}`,
        pm2Bin: 'npm',
        pm2Args: (s) => `run ${s}`
    };
}

/**
 * Step bật Corepack trên runner (chỉ cần cho pnpm/yarn để có sẵn đúng binary).
 */
function getCorepackStep(cmds) {
    if (!cmds.needCorepack) return '';
    return `
      - name: Enable Corepack (${cmds.pm})
        run: corepack enable
`;
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

/**
 * Gộp các dòng lệnh chạy trên VPS (qua appleboy/ssh-action) với thụt lề 12 dấu cách.
 */
function joinVpsScript(lines) {
    return lines.filter(Boolean).join('\n            ');
}

function getNodeWorkflow(opts) {
    const { domain, workingDir, usePrisma, port, envSecretName, isWorkspace, packageManager, startScript, hasBuild } = opts;
    const cmds = pmCommands(packageManager);
    const cleanDir = cleanWorkingDir(workingDir);
    const pm2Name = `app-${domain}`;
    const startCmd = startScript || 'start';
    // --update-env: áp dụng lại biến môi trường (gồm PORT) mỗi lần restart, tránh PM2 giữ env cũ.
    const pm2RestartCmd = `PORT=${port} pm2 restart ${pm2Name} --update-env || PORT=${port} pm2 start ${cmds.pm2Bin} --name "${pm2Name}" -- ${cmds.pm2Args(startCmd)}`;
    // Health-check: xác minh app THỰC SỰ nghe cổng được gán. Bắt lỗi hardcode cổng
    // (vd app.listen(3000) thay vì process.env.PORT) -> báo lỗi rõ ràng thay vì 502 âm thầm.
    const portHealthCheck = `ok=0; for i in $(seq 1 10); do if ss -tlnH 'sport = :${port}' 2>/dev/null | grep -q .; then ok=1; break; fi; sleep 2; done; if [ "$ok" != 1 ]; then echo "::error::App khong nghe cong ${port} sau ~20s. Rat co the code dang hardcode cong (vd app.listen(3000)) thay vi dung process.env.PORT."; pm2 logs ${pm2Name} --lines 20 --nostream 2>/dev/null; exit 1; fi`;
    const corepackStep = getCorepackStep(cmds);
    const corepackVps = cmds.needCorepack ? 'corepack enable 2>/dev/null || sudo corepack enable 2>/dev/null || true' : '';

    const prismaLines = usePrisma ? ['npx prisma generate', 'npx prisma db push --accept-data-loss'] : [];
    const buildStep = hasBuild
        ? `
      - name: Build Project
        run: ${cmds.run('build')}
`
        : '';

    if (isWorkspace) {
        // Monorepo workspaces (npm/pnpm/yarn + Turbo): cài & build ở GỐC repo.
        // Triển khai cả repo lên VPS, app chạy trong thư mục con.
        const envTarget = cleanDir ? `${cleanDir}/.env` : '.env';
        const envStep = getEnvStep(envSecretName, envTarget);
        const vpsRoot = `/var/www/${domain}`;
        const vpsAppDir = cleanDir ? `${vpsRoot}/${cleanDir}` : vpsRoot;

        const vpsScript = joinVpsScript([
            `cd ${vpsRoot}`,
            corepackVps,
            cmds.prod,
            vpsAppDir !== vpsRoot ? `cd ${vpsAppDir}` : '',
            ...prismaLines,
            pm2RestartCmd,
            'pm2 save',
            portHealthCheck
        ]);

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
${corepackStep}${envStep}
      - name: Install Dependencies (workspace root)
        run: ${cmds.ci}
${buildStep}
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
          rsync -avz --delete --exclude '.git' --exclude '.github' --exclude 'node_modules' ./ $USER@$HOST:${vpsRoot}

      - name: Restart PM2 & Update DB
        uses: appleboy/ssh-action@master
        with:
          host: \${{ secrets.VPS_HOST }}
          username: \${{ secrets.VPS_USERNAME }}
          key: \${{ secrets.VPS_SSH_KEY }}
          script: |
            ${vpsScript}
`;
    }

    // Mặc định (không phải workspace).
    const rsyncSrc = workingDir === './' ? './' : `${workingDir}/`;
    const envStep = getEnvStep(envSecretName, '.env');
    const vpsScript = joinVpsScript([
        `cd /var/www/${domain}`,
        corepackVps,
        cmds.prod,
        ...prismaLines,
        pm2RestartCmd,
        'pm2 save',
        portHealthCheck
    ]);

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
${corepackStep}${envStep}
      - name: Install Dependencies
        run: ${cmds.ci}
${buildStep}
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
          rsync -avz --delete --exclude '.git' --exclude '.github' --exclude 'node_modules' ${rsyncSrc} $USER@$HOST:/var/www/${domain}

      - name: Restart PM2 & Update DB
        uses: appleboy/ssh-action@master
        with:
          host: \${{ secrets.VPS_HOST }}
          username: \${{ secrets.VPS_USERNAME }}
          key: \${{ secrets.VPS_SSH_KEY }}
          script: |
            ${vpsScript}
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
          rsync -avz --delete --exclude '.git' --exclude '.github' --exclude 'storage/logs' ${rsyncSrc} $USER@$HOST:/var/www/${domain}

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
          rsync -avz --delete --exclude '.git' --exclude '.github' ${rsyncSrc} $USER@$HOST:/var/www/${domain}
`;
}

function getSpaWorkflow(opts) {
    const { domain, workingDir, buildDir, envSecretName, isWorkspace, packageManager } = opts;
    const cmds = pmCommands(packageManager);
    const cleanDir = cleanWorkingDir(workingDir);
    const corepackStep = getCorepackStep(cmds);

    if (isWorkspace) {
        // Monorepo workspaces: cài & build ở GỐC repo, chỉ rsync thư mục build.
        const envTarget = cleanDir ? `${cleanDir}/.env` : '.env';
        const envStep = getEnvStep(envSecretName, envTarget);
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
${corepackStep}${envStep}
      - name: Install Dependencies (workspace root)
        run: ${cmds.ci}

      - name: Build Project
        run: ${cmds.run('build')}

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
          rsync -avz --delete --exclude '.git' --exclude '.github' ${distPath} $USER@$HOST:/var/www/${domain}
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
${corepackStep}${envStep}
      - name: Install Dependencies
        run: ${cmds.ci}

      - name: Build Project
        run: ${cmds.run('build')}

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
          rsync -avz --delete --exclude '.git' --exclude '.github' ${rsyncSrc} $USER@$HOST:/var/www/${domain}
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
          rsync -avz --delete --exclude '.git' --exclude '.github' ${rsyncSrc} $USER@$HOST:/var/www/${domain}
`;
}

/**
 * Sinh file .github/workflows/deploy*.yml
 * options: { projectType, domain, role, workingDir, buildDir, usePrisma, port,
 *            envSecretName, isWorkspace, phpVersion, packageManager, startScript, hasBuild }
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
        phpVersion,
        packageManager,
        startScript,
        hasBuild
    } = options;

    const workflowsDir = path.join(process.cwd(), '.github', 'workflows');

    if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
    }

    let workflowContent = '';
    if (projectType.includes('Node.js')) {
        workflowContent = getNodeWorkflow({ domain, workingDir, usePrisma, port, envSecretName, isWorkspace, packageManager, startScript, hasBuild });
    } else if (projectType === 'PHP (Laravel)') {
        workflowContent = getLaravelWorkflow(domain, workingDir, envSecretName, phpVersion);
    } else if (projectType === 'PHP (Thuần)') {
        workflowContent = getPurePhpWorkflow(domain, workingDir, envSecretName);
    } else if (projectType === 'React/Vite/Vue (SPA)') {
        workflowContent = getSpaWorkflow({ domain, workingDir, buildDir, envSecretName, isWorkspace, packageManager });
    } else {
        workflowContent = getStaticWorkflow(domain, workingDir);
    }

    // Đặt tên file dựa trên role
    const fileName = role === 'Fullstack (Gốc)' ? 'deploy.yml' : `deploy-${role.toLowerCase()}.yml`;
    const workflowPath = path.join(workflowsDir, fileName);

    fs.writeFileSync(workflowPath, workflowContent);
    console.log(`Đã tạo file workflow tại: ${workflowPath}`);
}
