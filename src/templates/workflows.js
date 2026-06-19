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
 * Thư mục NGUỒN cho rsync trong nhánh KHÔNG-workspace.
 *
 * QUAN TRỌNG: khi workingDir là thư mục con, job đã set `defaults.run.working-directory`,
 * nên MỌI bước `run` (gồm cả bước rsync) đã chạy SẴN bên trong thư mục con đó. Vì vậy nguồn
 * rsync phải TƯƠNG ĐỐI với thư mục con — luôn là './' (toàn bộ nội dung thư mục đang đứng).
 * Nếu ghép thêm `${workingDir}/` sẽ tạo đường dẫn lồng (vd ./frontend/frontend) khiến rsync
 * báo "No such file or directory" và deploy thất bại.
 */
function rsyncSourceDir() {
    return './';
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
 *
 * Phân biệt 2 loại cài đặt:
 *   - `ci`  : cài trên RUNNER, NGAY TRƯỚC bước build (next build / vite build). BẮT BUỘC có
 *             devDependencies, vì toolchain build (typescript, @types/*, tailwindcss, eslint,
 *             autoprefixer...) thường nằm ở devDependencies. Ta ép cài cả devDeps một cách TƯỜNG MINH
 *             (npm --include=dev, pnpm/yarn --prod=false) để build KHÔNG hỏng kể cả khi runner lỡ có
 *             NODE_ENV=production — vì khi đó npm ci/pnpm/yarn sẽ ÂM THẦM bỏ devDeps -> build fail.
 *   - `prod`: cài trên VPS lúc runtime, SAU khi build artifact đã được rsync lên. CHỈ cần dependencies
 *             production (bỏ devDeps cho nhẹ). Không đụng tới phần này.
 */
function pmCommands(packageManager) {
    const pm = packageManager || 'npm';
    if (pm === 'pnpm') {
        return {
            pm: 'pnpm',
            needCorepack: true,
            ci: 'pnpm install --frozen-lockfile --prod=false || pnpm install --prod=false',
            prod: 'pnpm install --prod --frozen-lockfile || pnpm install --prod',
            run: (s) => `pnpm run ${s}`,
            pm2Bin: 'pnpm',
            pm2Args: (s) => `run ${s}`
        };
    }
    if (pm === 'yarn') {
        return {
            pm: 'yarn',
            needCorepack: true,
            ci: 'yarn install --frozen-lockfile --production=false || yarn install --production=false',
            prod: 'yarn install --production',
            run: (s) => `yarn ${s}`,
            pm2Bin: 'yarn',
            pm2Args: (s) => `${s}`
        };
    }
    return {
        pm: 'npm',
        needCorepack: false,
        ci: 'npm ci --include=dev || npm install --include=dev',
        prod: 'npm ci --production || npm install --production',
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

/**
 * Sinh lệnh rsync triển khai AN TOÀN cho dữ liệu runtime.
 * Vẫn dùng --delete để dọn file build cũ, NHƯNG bảo vệ (filter 'P') .env và các thư mục
 * upload phổ biến khỏi bị xóa — mọi file người dùng/dữ liệu không có trong repo sẽ KHÔNG bị xóa nhầm.
 *   src, dest: nguồn & đích. extra: mảng cờ bổ sung theo loại dự án (vd node_modules, storage).
 */
function buildRsync(src, dest, extra = []) {
    const flags = [
        '-avz', '--delete',
        "--exclude '.git'", "--exclude '.github'",
        "--filter='P .env'",            // không xóa .env trên server (vẫn cập nhật khi repo có)
        "--filter='P uploads'",         // dữ liệu upload phổ biến
        "--filter='P public/uploads'",
        ...extra
    ].join(' ');
    return `rsync ${flags} ${src} $USER@$HOST:${dest}`;
}

/**
 * Sinh step "Build Project" chạy trên runner (build TRƯỚC khi rsync, vì dist/ thường không nằm
 * trong git). buildWorkingDir: thư mục chạy build — rỗng nghĩa là dùng thư mục mặc định của job.
 * Với workspace mà CHỈ package con có script build (gốc không có), cần trỏ working-directory vào
 * package con (deps đã hoist về gốc nên build vẫn chạy) để dist/ được tạo, tránh thiếu dist khi deploy.
 */
function makeBuildStep(cmds, hasBuild, buildWorkingDir) {
    if (!hasBuild) return '';
    const wd = buildWorkingDir ? `
        working-directory: ${buildWorkingDir}` : '';
    return `
      - name: Build Project${wd}
        run: ${cmds.run('build')}
`;
}

function getNodeWorkflow(opts) {
    const { domain, workingDir, usePrisma, port, envSecretName, isWorkspace, packageManager, startScript, hasBuild, buildAtRoot, nodeVersion } = opts;
    const cmds = pmCommands(packageManager);
    const nodeVer = nodeVersion || '22';
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

    if (isWorkspace) {
        // Monorepo workspaces (npm/pnpm/yarn + Turbo): cài ở GỐC repo (deps hoist về gốc).
        // Build: nếu gốc có script build (vd turbo) -> build ở gốc; nếu chỉ package con có ->
        // build NGAY trong package con. Triển khai cả repo lên VPS, app chạy trong thư mục con.
        // buildAtRoot mặc định true (build ở gốc) để giữ tương thích; chỉ build trong package con
        // khi được chỉ định rõ là false (gốc không có script build).
        const buildStep = makeBuildStep(cmds, hasBuild, buildAtRoot === false ? cleanDir : '');
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
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${nodeVer}'
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
          ${buildRsync('./', vpsRoot, ["--exclude 'node_modules'"])}

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

    // Mặc định (không phải workspace). Build chạy trong working-directory của job nên không cần
    // chỉ định riêng. Nguồn rsync TƯƠNG ĐỐI với working-directory (xem rsyncSourceDir).
    const buildStep = makeBuildStep(cmds, hasBuild, '');
    const rsyncSrc = rsyncSourceDir();
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
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${nodeVer}'
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
          ${buildRsync(rsyncSrc, '/var/www/' + domain, ["--exclude 'node_modules'"])}

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
    const rsyncSrc = rsyncSourceDir();
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
        uses: actions/checkout@v4

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
          ${buildRsync(rsyncSrc, '/var/www/' + domain, ["--exclude 'storage/logs'", "--filter='P storage'"])}

      - name: Run Migrations & Cache
        uses: appleboy/ssh-action@master
        with:
          host: \${{ secrets.VPS_HOST }}
          username: \${{ secrets.VPS_USERNAME }}
          key: \${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /var/www/${domain}
            mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs storage/app/public bootstrap/cache
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
    const rsyncSrc = rsyncSourceDir();
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
        uses: actions/checkout@v4
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
          ${buildRsync(rsyncSrc, '/var/www/' + domain)}
`;
}

function getSpaWorkflow(opts) {
    const { domain, workingDir, buildDir, envSecretName, isWorkspace, packageManager, buildAtRoot, nodeVersion } = opts;
    const cmds = pmCommands(packageManager);
    const nodeVer = nodeVersion || '22';
    const cleanDir = cleanWorkingDir(workingDir);
    const corepackStep = getCorepackStep(cmds);

    if (isWorkspace) {
        // Monorepo workspaces: cài ở GỐC repo, chỉ rsync thư mục build.
        // Build ở gốc nếu gốc có script build (vd turbo); chỉ build trong package con khi buildAtRoot=false.
        const buildWd = buildAtRoot === false ? `
        working-directory: ${cleanDir}` : '';
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
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${nodeVer}'
${corepackStep}${envStep}
      - name: Install Dependencies (workspace root)
        run: ${cmds.ci}

      - name: Build Project${buildWd}
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
          ${buildRsync(distPath, '/var/www/' + domain)}
`;
    }

    // Nguồn rsync TƯƠNG ĐỐI với working-directory: chỉ thư mục build (vd 'dist/'), KHÔNG ghép workingDir
    // (job đã cd sẵn vào thư mục con). Ghép workingDir sẽ tạo đường dẫn lồng và rsync sẽ lỗi.
    const rsyncSrc = path.posix.join(rsyncSourceDir(), buildDir, '/'); // -> 'dist/'
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
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${nodeVer}'
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
          ${buildRsync(rsyncSrc, '/var/www/' + domain)}
`;
}

function getStaticWorkflow(domain, workingDir) {
    const rsyncSrc = rsyncSourceDir();
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
        uses: actions/checkout@v4

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
          ${buildRsync(rsyncSrc, '/var/www/' + domain)}
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
        hasBuild,
        buildAtRoot,
        nodeVersion
    } = options;

    const workflowsDir = path.join(process.cwd(), '.github', 'workflows');

    if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
    }

    let workflowContent = '';
    if (projectType.includes('Node.js')) {
        workflowContent = getNodeWorkflow({ domain, workingDir, usePrisma, port, envSecretName, isWorkspace, packageManager, startScript, hasBuild, buildAtRoot, nodeVersion });
    } else if (projectType === 'PHP (Laravel)') {
        workflowContent = getLaravelWorkflow(domain, workingDir, envSecretName, phpVersion);
    } else if (projectType === 'PHP (Thuần)') {
        workflowContent = getPurePhpWorkflow(domain, workingDir, envSecretName);
    } else if (projectType === 'React/Vite/Vue (SPA)') {
        workflowContent = getSpaWorkflow({ domain, workingDir, buildDir, envSecretName, isWorkspace, packageManager, buildAtRoot, nodeVersion });
    } else {
        workflowContent = getStaticWorkflow(domain, workingDir);
    }

    // Đặt tên file dựa trên role
    const fileName = role === 'Fullstack (Gốc)' ? 'deploy.yml' : `deploy-${role.toLowerCase()}.yml`;
    const workflowPath = path.join(workflowsDir, fileName);

    fs.writeFileSync(workflowPath, workflowContent);
    console.log(`Đã tạo file workflow tại: ${workflowPath}`);
}
