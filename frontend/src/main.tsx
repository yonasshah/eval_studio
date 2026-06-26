import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider
      theme={{
        primaryColor: 'navy',
        colors: {
          navy: ['#E6F0FF', '#C2D9FF', '#9DBFFF', '#7AA3F0', '#5B86DB', '#2563EB', '#1E4FC4', '#173D99', '#0F2A6E', '#0F172A'],
          teal: ['#E1F5EE', '#C3EBDC', '#9FE1CB', '#7BD6B9', '#46C5A0', '#14B8A6', '#0FA593', '#0B8A7B', '#086E62', '#04342C'],
        },
      }}
    >
      <Notifications position="bottom-right" />
      <App />
    </MantineProvider>
  </StrictMode>,
)
