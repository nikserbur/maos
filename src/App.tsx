import { useState } from 'react'
import AppShell from './shell/AppShell'
import { LoginScreen } from './features/auth/LoginScreen'

export default function App() {
  const [authed, setAuthed] = useState(false)
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />
  return <AppShell />
}
