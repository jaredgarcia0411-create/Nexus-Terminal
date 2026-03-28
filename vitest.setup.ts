import React from 'react';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
