import React, { useState } from 'react';
/* 1. Sửa lại import đúng chuẩn thư viện đã cài */
import { GoogleGenerativeAI } from "@google/generative-ai";

/* 2. Lấy API Key (Nhớ file .env phải có VITE_GEMINI_API_KEY) */
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

function App() {
  const [images, setImages] = useState([]);
  const [results, setResults] = useState([]); // Lưu danh sách các khoản thưởng
  const [loading, setLoading] = useState(false);
  const [totalMoney, setTotalMoney] = useState(0);

  // Xử lý chọn nhiều ảnh
  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    setImages(files);
    setResults([]); // Reset kết quả cũ
    setTotalMoney(0);
  };

  // Hàm chuyển file sang Base64 cho Gemini
  const fileToGenerativePart = async (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          inlineData: {
            data: reader.result.split(",")[1],
            mimeType: file.type,
          },
        });
      };
      reader.readAsDataURL(file);
    });
  };

  // Hàm tính toán chính
  const handleCalculate = async () => {
    if (images.length === 0) return alert("Vui lòng chọn ảnh bảng thưởng!");
    
    setLoading(true);
    setResults([]);

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      // Chuẩn bị dữ liệu ảnh gửi đi
      const imageParts = await Promise.all(images.map(fileToGenerativePart));

      // Câu lệnh Prompt cực kỹ để AI trả về JSON chuẩn
      const prompt = `
        Bạn là trợ lý kế toán. Hãy trích xuất dữ liệu từ các hình ảnh bảng lương/thưởng này.
        
        Yêu cầu xử lý:
        1. Tìm tất cả các dòng có nội dung là khoản thưởng (Ví dụ: "Thưởng thi đua", "Thưởng nộp tiền NH", "Khoán công việc", "Thưởng nóng"...).
        2. Lấy chính xác tên khoản thưởng (đầy đủ nguyên văn, không viết tắt) và số tiền.
        3. Trả về kết quả CHỈ LÀ MỘT MẢNG JSON thuần túy, không có Markdown (```json), không có lời dẫn.
        
        Cấu trúc JSON mong muốn:
        [
          { "ten": "Thưởng thi đua đợt 1...", "tien": 1000000 },
          { "ten": "Khoán công việc tháng 10...", "tien": 500000 }
        ]
      `;

      const result = await model.generateContent([prompt, ...imageParts]);
      const response = await result.response;
      const text = response.text();

      // Làm sạch chuỗi JSON (đề phòng AI thêm dấu ```json)
      const cleanJson = text.replace(/```json|```/g, "").trim();
      const data = JSON.parse(cleanJson);

      // Xử lý logic tính toán 30/70
      const processedData = data.map(item => ({
        ...item,
        quanLy: item.tien * 0.3, // 30%
        nhanVien: item.tien * 0.7 // 70%
      }));

      // Tính tổng
      const tong = processedData.reduce((acc, curr) => acc + curr.tien, 0);

      setResults(processedData);
      setTotalMoney(tong);

    } catch (error) {
      console.error(error);
      alert("Lỗi khi đọc ảnh hoặc AI trả về sai định dạng. Thử lại nhé!");
    } finally {
      setLoading(false);
    }
  };

  // Hàm định dạng tiền tệ (VND)
  const formatMoney = (amount) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
  };

  return (
    <div style={{ maxWidth: '900px', margin: '20px auto', fontFamily: 'Arial, sans-serif' }}>
      {/* --- HEADER --- */}
      <h1 style={{ textAlign: 'center', color: '#2c3e50', borderBottom: '2px solid #eee', paddingBottom: '10px' }}>
        Tính Thưởng Thi Đua
      </h1>

      {/* --- PHẦN NHẬP LIỆU --- */}
      <div style={{ background: '#f8f9fa', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Chọn ảnh hóa đơn/bảng kê:</label>
          <input 
            type="file" 
            multiple // Cho phép chọn nhiều ảnh
            accept="image/*"
            onChange={handleImageChange}
            style={{ padding: '10px' }}
          />
          <span style={{ marginLeft: '10px', color: '#666' }}>
            {images.length > 0 ? `Đã chọn ${images.length} ảnh` : '(Chưa chọn ảnh nào)'}
          </span>
        </div>

        <button 
          onClick={handleCalculate}
          disabled={loading}
          style={{
            background: loading ? '#95a5a6' : '#27ae60',
            color: 'white', border: 'none', padding: '12px 30px',
            fontSize: '16px', borderRadius: '5px', cursor: loading ? 'wait' : 'pointer',
            fontWeight: 'bold'
          }}
        >
          {loading ? 'Đang Phân Tích & Tính Toán...' : 'Bắt Đầu Tính Toán'}
        </button>
      </div>

      {/* --- PHẦN KẾT QUẢ --- */}
      {results.length > 0 && (
        <div>
          <h2 style={{ color: '#2980b9' }}>Chi Tiết Các Khoản Thưởng</h2>
          
          <div style={{ border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' }}>
            {results.map((item, index) => (
              <div key={index} style={{ 
                display: 'flex', 
                borderBottom: '1px solid #eee', 
                padding: '15px',
                background: index % 2 === 0 ? '#fff' : '#fcfcfc' // Màu so le cho dễ nhìn
              }}>
                {/* CỘT TRÁI: Nội dung chi tiết (70%) */}
                <div style={{ flex: '7', paddingRight: '20px' }}>
                  <div style={{ 
                    fontWeight: 'bold', 
                    color: '#34495e',
                    fontSize: '15px',
                    whiteSpace: 'pre-wrap', // QUAN TRỌNG: Giúp xuống dòng, không cắt chữ
                    wordBreak: 'break-word' // Ngắt dòng nếu từ quá dài
                  }}>
                    {item.ten}
                  </div>
                  <div style={{ color: '#7f8c8d', fontSize: '13px', marginTop: '5px' }}>
                    Gốc: {formatMoney(item.tien)}
                  </div>
                </div>

                {/* CỘT PHẢI: Người nhận (30%) */}
                <div style={{ flex: '3', borderLeft: '1px solid #eee', paddingLeft: '15px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ marginBottom: '5px', color: '#d35400', fontWeight: 'bold' }}>
                    Quản lý (30%): {formatMoney(item.quanLy)}
                  </div>
                  <div style={{ color: '#27ae60', fontWeight: 'bold' }}>
                    Nhân viên (70%): {formatMoney(item.nhanVien)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* TỔNG KẾT */}
          <div style={{ marginTop: '20px', textAlign: 'right', fontSize: '18px', fontWeight: 'bold' }}>
            Tổng cộng tiền thưởng gốc: <span style={{ color: '#c0392b' }}>{formatMoney(totalMoney)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

/* File: src/geminiConfig.js */
import { GoogleGenerativeAI } from "@google/generative-ai";

// 1. Lấy Key
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

// 2. Hàm chuyển đổi file ảnh sang Base64 (Gemini cần cái này)
export const fileToGenerativePart = async (file) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve({
        inlineData: {
          data: reader.result.split(",")[1], // Lấy phần mã hóa sau dấu phẩy
          mimeType: file.type,
        },
      });
    };
    reader.readAsDataURL(file);
  });
};

// 3. Khởi tạo Model
export const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/* File: src/App.jsx */
import { useState } from 'react';
import { fileToGenerativePart, model } from './geminiConfig'; // Import từ file cấu hình bước 3

function App() {
  const [hinhAnh, setHinhAnh] = useState(null);
  const [ketQua, setKetQua] = useState("");
  const [dangXuLy, setDangXuLy] = useState(false);

  // Xử lý khi chọn file
  const chonAnh = (e) => {
    const file = e.target.files[0];
    if (file) setHinhAnh(file);
  };

  // Xử lý gửi lên Gemini
  const guiYeuCau = async () => {
    if (!hinhAnh) return alert("Chưa chọn ảnh bạn ơi!");

    setDangXuLy(true);
    setKetQua("Đang soi ảnh...");

    try {
      // 1. Chuyển ảnh sang Base64
      const imagePart = await fileToGenerativePart(hinhAnh);

      // 2. Câu lệnh (Prompt)
      const prompt = "Hãy nhìn vào bức ảnh này và liệt kê chi tiết các khoản tiền thưởng, tên khoản thưởng và số tiền.";

      // 3. Gửi đi (bao gồm cả Lời nhắn + Ảnh)
      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      
      // 4. Nhận kết quả
      setKetQua(response.text());

    } catch (error) {
      console.error(error);
      setKetQua("Lỗi rồi: " + error.message);
    } finally {
      setDangXuLy(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Test Nhận Diện Ảnh</h1>
      
      {/* Nút chọn ảnh */}
      <input type="file" accept="image/*" onChange={chonAnh} />
      
      {/* Nút gửi */}
      <button 
        onClick={guiYeuCau} 
        disabled={dangXuLy}
        style={{ marginLeft: '10px', padding: '5px 15px' }}
      >
        {dangXuLy ? "Đang chạy..." : "Phân tích"}
      </button>

      {/* Kết quả */}
      <div style={{ marginTop: '20px', whiteSpace: 'pre-wrap', background: '#f0f0f0', padding: '10px' }}>
        {ketQua}
      </div>
    </div>
  );
}

export default App;