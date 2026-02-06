import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { MainCanvas } from './components/layout/MainCanvas';

function App() {
  return (
    <div className="flex flex-col h-screen w-full bg-page text-text-primary font-sans overflow-hidden">
      {/* Top Navigation */}
      <Header />
      
      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar />
        
        {/* Right Canvas */}
        <MainCanvas />
      </div>
    </div>
  );
}

export default App;
