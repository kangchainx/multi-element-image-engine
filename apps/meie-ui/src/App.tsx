import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { MainCanvas } from './components/layout/MainCanvas';
import { HistoryPanel } from './components/layout/HistoryPanel';

function App() {
  return (
    <div className="flex flex-col h-screen w-full bg-page text-text-primary font-sans overflow-hidden">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <MainCanvas />
        <HistoryPanel />
      </div>
    </div>
  );
}

export default App;
