
import { GoogleGenAI, Type } from "@google/genai";

// --- Type Declarations ---
export type BonusItem = { description: string; amount: number };

// Helper function to convert a Blob to a Base64 string
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (reader.result) {
                const base64data = (reader.result as string).split(',')[1];
                resolve(base64data);
            } else {
                reject(new Error("File reading failed"));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

/**
 * Processes an array of image files with Gemini to extract bonus information.
 * @param {File[]} images - The array of image files to process.
 * @returns {Promise<BonusItem[]>} A promise that resolves with an array of extracted bonus items.
 */
export async function processImagesForBonuses(images: File[]): Promise<BonusItem[]> {
    if (!images || images.length === 0) {
        throw new Error("Vui lòng chọn ít nhất một hình ảnh để xử lý.");
    }

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        console.error("API_KEY for Google GenAI is not configured.");
        throw new Error("API Key chưa được cấu hình.");
    }
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Từ hình ảnh được cung cấp, hãy trích xuất tất cả các dòng văn bản có chứa số tiền và bắt đầu bằng một trong các cụm từ sau: "Thưởng thi đua", "Khoán công việc", "Thưởng nộp tiền NH", "trợ cấp". Với mỗi dòng tìm thấy, hãy lấy toàn bộ nội dung mô tả và số tiền đi kèm (chỉ lấy số). Bỏ qua tất cả các dòng không liên quan. Trả về kết quả dưới dạng một mảng JSON. Mỗi đối tượng trong mảng phải có hai thuộc tính: "description" (string) và "amount" (number). Nếu không tìm thấy mục nào, trả về một mảng rỗng. Ví dụ: [{"description": "Thưởng thi đua doanh số tháng 5", "amount": 500000}]`;

    const imageProcessPromises = images.map(async (image) => {
        const base64Data = await blobToBase64(image);
        const imagePart = {
            inlineData: {
                mimeType: image.type,
                data: base64Data,
            },
        };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, { text: prompt }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            description: { type: Type.STRING },
                            amount: { type: Type.NUMBER },
                        },
                        required: ["description", "amount"],
                    },
                },
            },
        });
        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as BonusItem[];
    });

    const results = await Promise.allSettled(imageProcessPromises);
    
    const allBonuses: BonusItem[] = [];
    results.forEach(result => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            allBonuses.push(...result.value);
        } else if (result.status === 'rejected') {
            console.error("Một ảnh xử lý thất bại:", result.reason);
        }
    });

    return allBonuses;
}
