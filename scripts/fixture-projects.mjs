export const fixtureProjects = [
  {
    name: 'next-learn',
    url: 'https://github.com/vercel/next-learn.git',
    sha: 'bb2558441a6673ab76c89914c25018bffa27a2ba',
  },
  {
    name: 'vite-react-ts-starter',
    url: 'https://github.com/simerlec/vite-react-ts-starter.git',
    sha: '087a2581feaabeb9184515c72b0f7ff2325cd603',
  },
  {
    name: 'node-server',
    url: 'https://github.com/honojs/node-server.git',
    sha: '64dc09e0c37eab30b51d33d61a3a2bae3fdee263',
  },
  {
    name: 'changesets',
    url: 'https://github.com/changesets/changesets.git',
    sha: 'c9269c01af5f3f7463adc648890fc3a8a729dd18',
  },
  {
    name: 'express',
    url: 'https://github.com/expressjs/express.git',
    sha: '9a34acf03cb818ff3f8bc40e44176e277a25cbb9',
  },
  {
    name: 'flask',
    url: 'https://github.com/pallets/flask.git',
    sha: '2c1b30d0503cfb064f1cb252e6614a06915a362a',
    framework: 'Flask',
    entrypoint: 'examples/tutorial/flaskr/auth.py',
    resolvedFrom: 'src/flask/app.py',
  },
  {
    name: 'fastapi-full-stack',
    url: 'https://github.com/fastapi/full-stack-fastapi-template.git',
    sha: 'aabb90126964a164e02aff39e7c385bb0598236d',
    subdirectory: 'backend',
    framework: 'FastAPI',
    entrypoint: 'app/api/routes/items.py',
    resolvedFrom: 'app/api/routes/items.py',
  },
  {
    name: 'djangoproject',
    url: 'https://github.com/django/djangoproject.com.git',
    sha: 'ac544d9de0a1099eb765f7bba4d265f1c9db1747',
    framework: 'Django',
    entrypoint: 'releases/views.py',
    resolvedFrom: 'releases/urls.py',
  },
];
