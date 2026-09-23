/* eslint-config-next 16 ships native flat configs. Wrapping it in
   FlatCompat (the pre-16 setup) made ESLint crash with "Converting circular
   structure to JSON" before linting a single file. */
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = [
  ...nextCoreWebVitals,
  { ignores: ['.next/**', 'node_modules/**', 'public/**'] },
  {
    /* Style-level findings across older pages (straight quotes in JSX
       text; the React-compiler rule against setState inside effects) —
       kept visible as warnings so `npm run lint` can gate real bugs like
       rules-of-hooks violations, which stay errors. */
    rules: {
      'react/no-unescaped-entities': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];

export default eslintConfig;
