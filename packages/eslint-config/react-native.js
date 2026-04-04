/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['./base.js'],
  env: {
    'react-native/react-native': true,
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
  },
};
