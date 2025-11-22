/* File: src/gemini.js */
import { GoogleGenerativeAI } from "@google/generative-ai";

// Lấy key từ file .env
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// Khởi tạo
const genAI = new GoogleGenerativeAI(API_KEY);

// Hàm gửi tin nhắn cho AI
export const guiTinNhanChoAI = async (cauHoi) => {
  try {
    if (!API_KEY) {
      throw new Error("Chưa có API Key! Kiểm tra file .env đi bạn ơi.");
    }

    // Chọn model (gemini-1.5-flash là ngon bổ rẻ nhất cho app)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Gửi câu hỏi
    const result = await model.generateContent(cauHoi);
    const response = await result.response;
    
    // Trả về văn bản
    return response.text();
  } catch (error) {
    console.error("Lỗi nè:", error);
    return "Xin lỗi, AI đang bị chóng mặt, thử lại sau nha!";
  }
};
