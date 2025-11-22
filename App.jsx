/* File: src/App.jsx */
import { useState } from 'react';
import { guiTinNhanChoAI } from './gemini'; // Import cái hàm hồi nãy

function App() {
  const [cauHoi, setCauHoi] = useState('');
  const [traLoi, setTraLoi] = useState('');
  const [dangXuLy, setDangXuLy] = useState(false);

  const xuLyGui = async () => {
    if (!cauHoi) return;
    setDangXuLy(true);
    
    // Gọi hàm lấy kết quả từ AI
    const ketQua = await guiTinNhanChoAI(cauHoi);
    
    setTraLoi(ketQua);
    setDangXuLy(false);
  };

  return (
    <div style={{ padding: '50px', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Chat với Gemini AI</h1>
      
      {/* Ô nhập câu hỏi */}
      <textarea
        value={cauHoi}
        onChange={(e) => setCauHoi(e.target.value)}
        placeholder="Bạn muốn hỏi gì? (Ví dụ: Cách nấu phở bò)"
        style={{ width: '100%', height: '100px', padding: '10px', marginBottom: '10px' }}
      />
      
      {/* Nút bấm */}
      <button 
        onClick={xuLyGui} 
        disabled={dangXuLy}
        style={{ padding: '10px 20px', background: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
      >
        {dangXuLy ? 'Đang suy nghĩ...' : 'Gửi câu hỏi'}
      </button>

      {/* Kết quả */}
      {traLoi && (
        <div style={{ marginTop: '20px', padding: '20px', background: '#f5f5f5', borderRadius: '10px' }}>
          <strong>Gemini trả lời:</strong>
          <p style={{ whiteSpace: 'pre-line' }}>{traLoi}</p>
        </div>
      )}
    </div>
  );
}

export default App;