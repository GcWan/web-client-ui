const path = require('path');

module.exports = api => ({
  presets: [
    [
      '@babel/preset-env',
      {
        // Setting false will NOT convert ES6 to CJS modules
        // Test env must set to auto since Jest ESM support is experimental
        modules: api.env('test') ? 'auto' : false,
        targets: api.env('test')
          ? undefined
          : {
              esmodules: true,
            },
        include: ['@babel/plugin-proposal-class-properties'],
      },
    ],
    ['@babel/preset-react', { runtime: 'automatic' }],
    ['@babel/preset-typescript', { allowDeclareFields: true }],
  ],
  plugins: [
    api.env('test')
      ? [
          // This is needed to replace import.meta.env w/ process in Jest
          // Jest does not play nicely w/ ESM and Vite uses import.meta
          // import.meta is only avaialable in ESM
          path.resolve(__dirname, 'importMetaEnvPlugin'),
        ]
      : false,
    api.env('test')
      ? [
          // Also need to handle import.meta.url
          'babel-plugin-transform-import-meta',
        ]
      : false,
    api.env('test')
      ? false // The add-import-extension plugin causes Jest to error, but is needed for proper ESM builds
      : ['babel-plugin-add-import-extension'],
    [
      'transform-rename-import',
      {
        // The babel-plugin-add-import-extension adds the .js to .scss imports, just convert them back to .css
        original: '^(.+?)\\.s?css(\\?(?:inline|raw))?\\.js$',
        replacement: '$1.css$2',
      },
    ],
  ].filter(Boolean),
});
