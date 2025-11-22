import React, { useState, useMemo, useRef, useEffect } from 'react';

// --- Type Declarations ---
declare global {
  interface Window {
    XLSX: any;
    QRCode: any;
    JsBarcode: any;
    Tesseract: any;
  }
}

type Page = 'trang-chu' | 'kiem-quy' | 'kiem-tra-ton-kho' | 'kiem-ke' | 'thong-tin' | 'kiem-hang-chuyen-kho' | 'thay-posm' | 'ma-qr' | 'tinh-thuong';

type User = {
  username: string;
  password: string;
  role: 'admin' | 'user';
  tier?: 'free' | 'vip';
  vipExpiry?: number; // Timestamp for VIP expiration
};

type InventoryItem = {
  qrCode: string; // The primary value for QR code generation (IMEI if present, else Product Code)
  productCodeForSearch: string; // Always store the product code for searching purposes
  productName: string;
  quantity: number;
  price: number;
  checked: boolean;
  hasImei: boolean;
  status: string;
  category: string;
};

type ExcelCheckItem = {
  productCode: string;
  productName: string;
  fileQuantity: number;
  actualQuantity: number | null; // null means not yet counted
  imei?: string;
  category: string;
};

type FundCheckResult = {
  id: number; // Using timestamp for a unique ID
  checkTime: Date;
  targetFund: number;
  smallChange: number;
  adjustedTargetFund: number;
  totalCash: number;
  difference: number;
  counts: Record<number, number>;
  subtotals: Record<number, number>;
};

type PosmChangeItem = {
  productCode: string;
  productName: string;
  oldPrice: number;
  newPrice: number;
  promotion?: string;
  bonusPoint?: string;
};

type BonusItem = {
    description: string;
    amount: number;
};


// --- Helper Functions ---
const denominations = [
  { value: 500000 }, { value: 200000 }, { value: 100000 }, { value: 50000 },
  { value: 20000 }, { value: 10000 }, { value: 5000 }, { value: 2000 }, { value: 1000 },
];

const formatCurrency = (value: number) => {
  if (isNaN(value)) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(0);
  }
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
};

const formatNumber = (value: number | undefined | null) => {
    if (value === undefined || value === null || value === 0) return '';
    return new Intl.NumberFormat('vi-VN').format(value);
}

const parseFormattedNumber = (value: string): number => {
    const rawValue = String(value).replace(/\D/g, '');
    const number = parseInt(rawValue, 10);
    return isNaN(number) ? 0 : number;
}

const findValue = (row: any, keys: string[]): any => {
    for (const targetKey of keys) {
        const lowerTargetKey = targetKey.toLowerCase().trim();
        for (const rowKey in row) {
            if (row.hasOwnProperty(rowKey) && rowKey.toLowerCase().trim() === lowerTargetKey) {
                return row[rowKey];
            }
        }
    }
    return undefined;
};

const parseProductNameForPosm = (name: string): string => {
    if (!name) return '';

    const specRegex = /\b\d+(\.\d+)?(L(ÍT)?|KG)\b/i;
    const junkKeywords = ['INVERTER', 'LĐ'];
    const parts = name.split('|');

    let specPart = '';
    const mainParts: string[] = [];

    parts.forEach(part => {
        const currentPart = part.trim();
        if (!specPart && specRegex.test(currentPart)) {
            specPart = currentPart;
        } else if (junkKeywords.some(keyword => currentPart.toUpperCase() === keyword)) {
            // Bỏ qua các từ khóa không cần thiết
        } else {
            mainParts.push(currentPart);
        }
    });

    const baseName = mainParts.join('|');
    
    if (specPart) {
        return `${baseName} (${specPart})`;
    }

    return baseName;
};

const getCategoryFromProductName = (name: string): string => {
    if (!name || typeof name !== 'string') return 'default';
    const lowerName = name.toLowerCase().trim();
    if (lowerName === '') return 'default';

    // Prioritize prefixes like 'TV', 'Tivi', but also catch whole word 'TV' elsewhere.
    if (/^(tivi|ti vi|tv)/.test(lowerName) || /\btv\b/.test(lowerName)) return 'tivi';
    if (lowerName.includes('tủ lạnh')) return 'tủ lạnh';
    if (lowerName.includes('máy giặt')) return 'máy giặt';
    if (lowerName.includes('máy lạnh') || lowerName.includes('điều hòa')) return 'máy lạnh';
    if (lowerName.includes('điện thoại')) return 'điện thoại';
    if (lowerName.includes('loa')) return 'loa';
    return 'default';
};

const getCategoryIconName = (category: string): string => {
    const lowerCategory = category.toLowerCase();
    if (lowerCategory.includes('loa')) return 'lucide-speaker';
    if (lowerCategory.includes('tivi') || lowerCategory.includes('ti vi') || /\btv\b/.test(lowerCategory)) return 'tv';
    if (lowerCategory.includes('tủ lạnh')) return 'kitchen';
    if (lowerCategory.includes('máy giặt')) return 'local_laundry_service';
    if (lowerCategory.includes('máy lạnh') || lowerCategory.includes('điều hòa')) return 'ac_unit';
    if (lowerCategory.includes('điện thoại')) return 'smartphone';
    if (lowerCategory.includes('gift')) return 'card_giftcard';
    return 'inventory_2'; // Default
};

const getIconSvg = (category: string, className: string = "") => {
    const iconName = getCategoryIconName(category);
    if (iconName === 'lucide-speaker') {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}" style="vertical-align: middle; display: inline-block;"><rect width="16" height="20" x="4" y="2" rx="2"/><circle cx="12" cy="14" r="4"/><line x1="12" x2="12.01" y1="6" y2="6"/></svg>`;
    }
    // Using `vertical-align: middle` to better align font icons with text.
    return `<span class="material-symbols-outlined ${className}" style="vertical-align: middle;">${iconName}</span>`;
};

// --- Reusable Components ---
const StatCard: React.FC<{ title: string; value: string | number; className?: string; }> = ({ title, value, className }) => (
    <div className={`bg-white p-4 rounded-lg shadow-sm border border-slate-200 ${className}`}>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="text-2xl font-bold font-mono text-slate-800 tracking-tight">{value}</p>
    </div>
);

const QRCodeComponent: React.FC<{ text: string, size?: number }> = ({ text, size = 64 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (canvasRef.current && text) {
            window.QRCode.toCanvas(canvasRef.current, text, { width: size, margin: 1 }, (error: any) => {
                if (error) console.error(error);
            });
        }
    }, [text, size]);

    return <canvas ref={canvasRef} style={{ width: `${size}px`, height: `${size}px` }} />;
};

const BarcodeComponent: React.FC<{ text: string; format?: string }> = ({ text, format = "CODE128" }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (canvasRef.current && text) {
            try {
                window.JsBarcode(canvasRef.current, text, {
                    format: format,
                    lineColor: "#000",
                    width: 2,
                    height: 100,
                    displayValue: true
                });
            } catch (e) {
                console.error("Invalid barcode data", e);
            }
        }
    }, [text, format]);

    return <canvas ref={canvasRef} className="max-w-full h-auto" />;
};


const CategoryIcon: React.FC<{ category: string; className?: string }> = ({ category, className = "text-base" }) => {
    const iconName = getCategoryIconName(category);
    if (iconName === 'lucide-speaker') {
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="1em"
                height="1em"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={className}
                style={{ verticalAlign: 'middle', display: 'inline-block' }}
                aria-hidden="true"
                focusable="false"
            >
                <rect width="16" height="20" x="4" y="2" rx="2" />
                <circle cx="12" cy="14" r="4" />
                <line x1="12" x2="12.01" y1="6" y2="6" />
            </svg>
        );
    }
    return <span className={`material-symbols-outlined ${className}`}>{iconName}</span>;
};

// --- Main App Component ---
const SESSION_TIMEOUT_MS = 48 * 60 * 60 * 1000; // 48 hours

const pageTitles: Record<Page, string> = {
  'trang-chu': 'Trang Chủ',
  'kiem-quy': 'Kiểm Quỹ',
  'kiem-ke': 'Kiểm Kê',
  'kiem-tra-ton-kho': 'Kiểm Tra Tồn Kho',
  'kiem-hang-chuyen-kho': 'Kiểm Hàng Chuyển Kho',
  'thay-posm': 'Thay POSM',
  'ma-qr': 'Tạo Mã QR',
  'thong-tin': 'Thông Tin',
  'tinh-thuong': 'Tính Thưởng'
};

const ReportBugButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
    return (
        <button
            onClick={onClick}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-semibold rounded-full shadow-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-all duration-300 transform hover:scale-105"
            title="Báo lỗi chức năng này"
        >
            <span className="material-symbols-outlined text-base">bug_report</span>
            <span className="hidden sm:inline text-sm">Báo lỗi</span>
        </button>
    );
};


export const App: React.FC = () => {
  // --- State for Authentication ---
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  // Login form state
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  // Register form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState('');
  
  const [currentPage, setCurrentPage] = useState<Page>('trang-chu');
  
  // Dropdowns state
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  
  const [isFeatureMenuOpen, setIsFeatureMenuOpen] = useState(false);
  const featureMenuRef = useRef<HTMLDivElement>(null);
  
  // State for Kiem Quy
  const [counts, setCounts] = useState<Record<number, number>>(
    denominations.reduce<Record<number, number>>((acc, d) => ({ ...acc, [d.value]: 0 }), {})
  );
  const [targetFund, setTargetFund] = useState<number>(0);
  const [smallChange, setSmallChange] = useState<number>(0);
  const [lastResetTime, setLastResetTime] = useState<Date | null>(null);
  const [savedFundChecks, setSavedFundChecks] = useState<FundCheckResult[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  // State for Kiem Ke & Kiem Tra Ton Kho
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  const [imeiFilter, setImeiFilter] = useState<'all' | 'with_imei' | 'without_imei'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | string>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');
  const [availableStatuses, setAvailableStatuses] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  // State for Kiem Tra Ton Kho
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchHistory, setSearchHistory] = useState<{ query: string; result: InventoryItem | null }[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<(InventoryItem & { originalIndex: number })[]>([]);
  const [isSuggestionsVisible, setIsSuggestionsVisible] = useState(false);

  // State for Kiem Hang Chuyen Kho
  const [excelCheckItems, setExcelCheckItems] = useState<ExcelCheckItem[]>([]);
  const [excelCheckFileName, setExcelCheckFileName] = useState<string>('');
  const [scanQuery, setScanQuery] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [lastScannedIndex, setLastScannedIndex] = useState<number | null>(null);
  const [scanStatus, setScanStatus] = useState<{type: 'idle' | 'success' | 'error', message: string}>({type: 'idle', message: 'Sẵn sàng quét...'});

  // State for Thay POSM
  const [posmItems, setPosmItems] = useState<PosmChangeItem[]>([]);
  const [posmFileName, setPosmFileName] = useState<string>('');
  const [selectedPosmItems, setSelectedPosmItems] = useState<string[]>([]);

  // State for Ma QR
  const [qrGeneratorText, setQrGeneratorText] = useState<string>('');
  const [codeType, setCodeType] = useState<'qr' | 'barcode'>('qr');

  // State for Tinh Thuong
  const [bonusImages, setBonusImages] = useState<File[]>([]);
  const [bonusItems, setBonusItems] = useState<BonusItem[]>([]);
  const [isAnalyzingBonus, setIsAnalyzingBonus] = useState<boolean>(false);
  const [bonusAnalysisProgress, setBonusAnalysisProgress] = useState<{ status: string; progress: number } | null>(null);
  const [excludedBonusIndices, setExcludedBonusIndices] = useState<number[]>([]);
  const [isBonusFilterDropdownOpen, setIsBonusFilterDropdownOpen] = useState(false);
  const bonusFilterDropdownRef = useRef<HTMLDivElement>(null);
  const [bonusDeduction, setBonusDeduction] = useState<number>(0);
  const [qrModalData, setQrModalData] = useState<{ name: string; qrLink: string; } | null>(null);

  // State for Bug Report Modal
  const [isBugReportOpen, setIsBugReportOpen] = useState<boolean>(false);
  const [bugReportPage, setBugReportPage] = useState<string>('');
  const [bugReportSummary, setBugReportSummary] = useState<string>('');
  const [bugReportDetails, setBugReportDetails] = useState<string>('');
  const [bugReportScreenshot, setBugReportScreenshot] = useState<File | null>(null);
  const [bugReportScreenshotPreview, setBugReportScreenshotPreview] = useState<string | null>(null);

  // State for VIP Upgrade Modal
  const [isVipModalOpen, setIsVipModalOpen] = useState<boolean>(false);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState<boolean>(false);

  // Static data & user roles
  const isAdmin = currentUser?.role === 'admin';
  const isVip = currentUser?.tier === 'vip';
  const isFree = currentUser?.tier === 'free';
  
  const paidFeatures: Page[] = ['kiem-hang-chuyen-kho', 'kiem-tra-ton-kho', 'thay-posm', 'ma-qr'];
  
  const isFeatureLocked = (page: Page): boolean => {
      if (isAdmin || isVip) return false;
      return paidFeatures.includes(page);
  };

  // --- Bug Report Logic ---
  const handleOpenBugReport = (page: Page) => {
      setBugReportPage(pageTitles[page] || 'Chung');
      setIsBugReportOpen(true);
  };

  const handleCloseBugReport = () => {
      setIsBugReportOpen(false);
      // Delay resetting state to allow for closing animation
      setTimeout(() => {
          setBugReportPage('');
          setBugReportSummary('');
          setBugReportDetails('');
          setBugReportScreenshot(null);
          if (bugReportScreenshotPreview) {
             URL.revokeObjectURL(bugReportScreenshotPreview);
          }
          setBugReportScreenshotPreview(null);
      }, 300);
  };

  const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (bugReportScreenshotPreview) {
          URL.revokeObjectURL(bugReportScreenshotPreview);
      }
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          setBugReportScreenshot(file);
          setBugReportScreenshotPreview(URL.createObjectURL(file));
      } else {
          setBugReportScreenshot(null);
          setBugReportScreenshotPreview(null);
      }
  };

  const handleBugReportSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const subject = `[Báo lỗi] Hỗ Trợ Công Việc - Chức năng: ${bugReportPage}`;
      let body = `Tình trạng lỗi:\n${bugReportSummary}\n\n`;
      body += `Nội dung chi tiết:\n${bugReportDetails}\n\n`;
      if (bugReportScreenshot) {
          body += `------------------------------------------------------\n`;
          body += `LƯU Ý: Vui lòng đính kèm tệp ảnh chụp màn hình "${bugReportScreenshot.name}" vào email này để chúng tôi có thể hỗ trợ tốt nhất.\n`;
          body += `------------------------------------------------------`;
      }
      
      const mailtoLink = `mailto:daotheanh51118@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailtoLink;
      handleCloseBugReport();
  };


  // --- Authentication & Session Logic ---
  const handleLogout = () => {
      setIsAuthenticated(false);
      setCurrentUser(null);
      setIsUserMenuOpen(false);
      localStorage.removeItem('currentUser');
      localStorage.removeItem('lastActivity');
      setCurrentPage('trang-chu');
  };

  useEffect(() => {
    // Restore session on app load
    try {
        const savedUserJson = localStorage.getItem('currentUser');
        const lastActivityTime = localStorage.getItem('lastActivity');
        if (savedUserJson && lastActivityTime) {
            let user: User = JSON.parse(savedUserJson);
            if (user.role === 'user' && !user.tier) {
                user.tier = 'free'; // Ensure backward compatibility
            }
            // Check VIP expiry
            if (user.tier === 'vip' && user.vipExpiry && user.vipExpiry < new Date().getTime()) {
                user.tier = 'free';
                user.vipExpiry = undefined;
            }
            
            const isSessionActive = new Date().getTime() - parseInt(lastActivityTime, 10) < SESSION_TIMEOUT_MS;
            if (user.role === 'admin' || isSessionActive) {
                setCurrentUser(user);
                setIsAuthenticated(true);
            } else {
                localStorage.removeItem('currentUser');
                localStorage.removeItem('lastActivity');
            }
        }
    } catch (error) {
        console.error("Failed to restore session:", error);
        localStorage.removeItem('currentUser');
        localStorage.removeItem('lastActivity');
    }

    // Load users list from storage
    try {
        const savedUsers = localStorage.getItem('app_users');
        if (savedUsers) {
            const parsedUsers: User[] = JSON.parse(savedUsers).map((u: any) => ({ 
                ...u, 
                role: u.role || 'user',
                tier: u.tier || (u.role === 'user' ? 'free' : undefined)
            }));
            setUsers(parsedUsers);
        } else {
            // Add default admin and test user
            const defaultUsers: User[] = [
                { username: 'admin', password: '0311', role: 'admin' },
                { username: 'user', password: '123', role: 'user', tier: 'free' }
            ];
            setUsers(defaultUsers);
            localStorage.setItem('app_users', JSON.stringify(defaultUsers));
        }
    } catch (error) {
        console.error("Failed to load users from localStorage:", error);
    }
  }, []);

  useEffect(() => {
    // Manage session activity and timeout for authenticated users
    if (!isAuthenticated || !currentUser) return;
    if (currentUser.role === 'admin') return; // No timeout for admin

    const updateLastActivity = () => {
        localStorage.setItem('lastActivity', new Date().getTime().toString());
    };

    updateLastActivity();
    const activityEvents: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'click', 'scroll'];
    activityEvents.forEach(event => window.addEventListener(event, updateLastActivity, { passive: true }));

    const intervalId = setInterval(() => {
        const lastActivityTime = localStorage.getItem('lastActivity');
        if (lastActivityTime) {
            if (new Date().getTime() - parseInt(lastActivityTime, 10) > SESSION_TIMEOUT_MS) {
                alert('Phiên đăng nhập đã hết hạn do không hoạt động. Vui lòng đăng nhập lại.');
                handleLogout();
            }
        }
    }, 60 * 1000); // Check every minute

    return () => {
        clearInterval(intervalId);
        activityEvents.forEach(event => window.removeEventListener(event, updateLastActivity));
    };
  }, [isAuthenticated, currentUser]);

  useEffect(() => {
    // Tier-based page access control
    if (isAuthenticated && isFeatureLocked(currentPage)) {
        alert('Tính năng này chỉ dành cho tài khoản VIP. Vui lòng nâng cấp trong trang "Thông Tin" để sử dụng.');
        setCurrentPage('trang-chu');
    }
  }, [currentPage, isAuthenticated, currentUser]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (featureMenuRef.current && !featureMenuRef.current.contains(event.target as Node)) {
        setIsFeatureMenuOpen(false);
      }
      if (bonusFilterDropdownRef.current && !bonusFilterDropdownRef.current.contains(event.target as Node)) {
        setIsBonusFilterDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterSuccess(''); // Clear any registration success message
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);

    if (user) {
        // Check VIP status on login
        if (user.tier === 'vip' && user.vipExpiry && user.vipExpiry < new Date().getTime()) {
            user.tier = 'free';
            user.vipExpiry = undefined;
        }
        setIsAuthenticated(true);
        setCurrentUser(user);
        localStorage.setItem('currentUser', JSON.stringify(user));
        localStorage.setItem('lastActivity', new Date().getTime().toString());
        setLoginError('');
        setUsername('');
        setPassword('');
    } else {
        setLoginError('Tên đăng nhập hoặc mật khẩu không chính xác.');
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError('');
    if (newPassword !== confirmPassword) {
      setRegisterError('Mật khẩu xác nhận không khớp.');
      return;
    }
    if (newPassword.length < 3) {
      setRegisterError('Mật khẩu phải có ít nhất 3 ký tự.');
      return;
    }
    if (users.some(u => u.username.toLowerCase() === newUsername.toLowerCase())) {
      setRegisterError('Tên đăng nhập này đã tồn tại.');
      return;
    }
    
    const newUser: User = { username: newUsername, password: newPassword, role: 'user', tier: 'free' };
    const updatedUsers = [...users, newUser];
    setUsers(updatedUsers);
    localStorage.setItem('app_users', JSON.stringify(updatedUsers));

    setNewUsername('');
    setNewPassword('');
    setConfirmPassword('');
    setRegisterError('');
    setRegisterSuccess('Đăng ký thành công! Vui lòng đăng nhập.');
    setAuthView('login');
  };

  const handleFeatureClick = (page: Page) => {
    if (isFeatureLocked(page)) {
      alert('Tính năng này chỉ dành cho tài khoản VIP. Vui lòng nâng cấp trong trang "Thông Tin" để sử dụng.');
    } else {
      setCurrentPage(page);
    }
  };
  
   const handleUpgradeToVip = () => {
        // Disabled for now
        // setIsVipModalOpen(true);
    };

    const handleConfirmVipPayment = () => {
        if (!currentUser || currentUser.role !== 'user') return;

        setIsVerifyingPayment(true);

        // Mô phỏng quy trình kiểm tra Server-side (Webhook)
        setTimeout(() => {
            // 1. Kiểm tra Chữ Ký Bảo Mật (Signature) - Mô phỏng
            console.log("Bước 1: Kiểm tra chữ ký bảo mật... Hợp lệ.");

            // 2. Lấy thông tin đơn hàng - Mô phỏng
            console.log("Bước 2: Lấy thông tin đơn hàng... Đã tìm thấy.");

            // 3. Kiểm tra trạng thái đơn hàng - Mô phỏng
            // Nếu đã hoàn thành thì không cộng thêm, nhưng ở đây là user click xác nhận mới -> coi như đơn mới hợp lệ.
            console.log("Bước 3: Kiểm tra trạng thái... Đơn hàng mới (Pending).");

            // 4. Kiểm tra số tiền - Mô phỏng
            const expectedAmount = 10000;
            console.log(`Bước 4: Kiểm tra số tiền... Đã nhận ${expectedAmount}đ (Khớp).`);

            // 5. Thành công -> Kích hoạt/Gia hạn VIP
            // Logic: Nếu tài khoản đang là VIP và còn hạn, cộng thêm 30 ngày vào hạn cũ.
            // Nếu hết hạn hoặc chưa phải VIP, tính từ thời điểm hiện tại.
            
            const currentExpiry = (currentUser.tier === 'vip' && currentUser.vipExpiry) ? currentUser.vipExpiry : new Date().getTime();
            // Đảm bảo không cộng dồn vào quá khứ nếu đã hết hạn từ lâu
            const baseTime = Math.max(currentExpiry, new Date().getTime());
            const expiryDate = new Date(baseTime + (30 * 24 * 60 * 60 * 1000)); // Cộng thêm 30 ngày

            const updatedCurrentUser: User = { 
                ...currentUser, 
                tier: 'vip',
                vipExpiry: expiryDate.getTime()
            };
            
            setCurrentUser(updatedCurrentUser);
            localStorage.setItem('currentUser', JSON.stringify(updatedCurrentUser));

            const updatedUsers = users.map(u =>
                u.username === currentUser.username ? updatedCurrentUser : u
            );
            setUsers(updatedUsers);
            localStorage.setItem('app_users', JSON.stringify(updatedUsers));

            setIsVerifyingPayment(false);
            setIsVipModalOpen(false);
            alert(`Thanh toán thành công! Gói VIP đã được kích hoạt/gia hạn. Hạn sử dụng đến: ${expiryDate.toLocaleDateString('vi-VN')}`);

        }, 2000); // Giả lập độ trễ 2 giây để kiểm tra
    };
  
  useEffect(() => {
    try {
        const savedData = localStorage.getItem('fundCheckHistory');
        if (savedData) {
            const parsedData = JSON.parse(savedData).map((item: any) => ({
                ...item,
                checkTime: new Date(item.checkTime)
            }));
            setSavedFundChecks(parsedData);
        }
    } catch (error) {
        console.error("Failed to load fund check history:", error);
        setSavedFundChecks([]);
    }
  }, []);
  
  useEffect(() => {
    if (currentPage === 'kiem-tra-ton-kho' && searchQuery.trim().length > 1) {
        const lowerCaseQuery = searchQuery.toLowerCase();
        const filteredSuggestions = inventoryItems
            .map((item, index) => ({ ...item, originalIndex: index }))
            .filter(item =>
                item.productName.toLowerCase().includes(lowerCaseQuery)
            ).slice(0, 7); // Limit to 7 results
        
        setSuggestions(filteredSuggestions);
        setIsSuggestionsVisible(filteredSuggestions.length > 0);
    } else {
        setSuggestions([]);
        setIsSuggestionsVisible(false);
    }
}, [searchQuery, inventoryItems, currentPage]);

    useEffect(() => {
        if (currentPage === 'kiem-hang-chuyen-kho' && excelCheckItems.length > 0) {
            scanInputRef.current?.focus();
        }
    }, [currentPage, excelCheckItems.length]);


  // --- Kiem Quy Logic ---
  const handleCountChange = (denomination: number, value: string | number) => {
    const newCount = typeof value === 'string' ? parseInt(value, 10) : value;
    setCounts(prevCounts => ({
      ...prevCounts,
      [denomination]: isNaN(newCount) || newCount < 0 ? 0 : newCount,
    }));
  };
  
  const handleTargetFundChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setTargetFund(parseFormattedNumber(e.target.value));
  };
  
  const handleSmallChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setSmallChange(parseFormattedNumber(e.target.value));
  };

  const subtotals = useMemo(() => {
    return denominations.reduce<Record<number, number>>((acc, d) => ({
      ...acc,
      [d.value]: d.value * (counts[d.value] || 0)
    }), {});
  }, [counts]);
  
  const totalCash = useMemo(() => {
      return Object.values(subtotals).reduce((sum: number, val: number) => sum + val, 0);
  }, [subtotals]);

  const adjustedTargetFund = useMemo(() => {
    return targetFund - smallChange;
  }, [targetFund, smallChange]);

  const difference = useMemo(() => {
      return totalCash - adjustedTargetFund;
  }, [totalCash, adjustedTargetFund]);

  const handleReset = () => {
    setCounts(denominations.reduce<Record<number, number>>((acc, d) => ({ ...acc, [d.value]: 0 }), {}));
    setTargetFund(0);
    setSmallChange(0);
    setLastResetTime(new Date());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, currentIndex: number) => {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = currentIndex + 1;
      if (nextIndex < denominations.length) {
        const nextDenom = denominations[nextIndex].value;
        const nextInput = document.getElementById(`denom-${nextDenom}`);
        if (nextInput) {
          nextInput.focus();
        }
      } else if (event.key === 'Enter') {
        // After last input, Enter focuses the Save button
        const saveButton = document.getElementById('save-button');
        if (saveButton) {
          saveButton.focus();
        }
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevIndex = currentIndex - 1;
      if (prevIndex >= 0) {
        const prevDenom = denominations[prevIndex].value;
        const prevInput = document.getElementById(`denom-${prevDenom}`);
        if (prevInput) {
          prevInput.focus();
        }
      }
    }
  };

  const getDifferenceColor = () => {
    if (difference === 0) return 'text-green-600 bg-green-100/80 border-green-200';
    if (difference > 0) return 'text-amber-600 bg-amber-100/80 border-amber-200';
    return 'text-red-600 bg-red-100/80 border-red-200';
  }

  const getDifferenceLabel = () => {
    if (difference > 0) return 'Chênh Lệch (Dư)';
    if (difference < 0) return 'Chênh Lệch (Thiếu)';
    return 'Chênh Lệch (Khớp)';
  }

  const handleSave = () => {
    const now = new Date();
    const resultData: FundCheckResult = {
        id: now.getTime(),
        checkTime: lastResetTime || now,
        targetFund,
        smallChange,
        adjustedTargetFund,
        totalCash,
        difference,
        counts,
        subtotals,
    };
    const updatedHistory = [resultData, ...savedFundChecks];
    setSavedFundChecks(updatedHistory);
    localStorage.setItem('fundCheckHistory', JSON.stringify(updatedHistory));
    alert('Đã lưu kết quả kiểm quỹ thành công!');
  };

  const handlePrint = () => {
    const printContent = `
      <html><head><title>Biên Bản Kiểm Quỹ</title><style>body{font-family:'Inter',sans-serif;margin:25px;color:#212121}h1{text-align:center;margin-bottom:20px}table{width:100%;border-collapse:collapse;margin-top:20px;font-size:14px}th,td{border:1px solid #ccc;padding:10px;text-align:left}th{background-color:#f2f2f2}.summary{margin-top:20px;font-size:16px}.summary p{margin:8px 0}.summary .total{font-weight:bold}.details-table td:nth-child(2),.details-table td:nth-child(3){text-align:right}.footer{margin-top:50px;text-align:center}</style></head><body><h1>BIÊN BẢN KIỂM QUỸ</h1><div class="summary"><p><strong>Thời gian:</strong> ${(lastResetTime||new Date).toLocaleString('vi-VN')}</p><hr style="border:0;border-top:1px solid #ccc;margin:15px 0"><p>Tổng dư quỹ cần kiểm: ${formatCurrency(targetFund)}</p><p>Tiền lẻ (không đếm): ${formatCurrency(smallChange)}</p><p class="total">Quỹ cần cân đối: ${formatCurrency(adjustedTargetFund)}</p><p class="total">Tổng tiền mặt đếm được: ${formatCurrency(totalCash)}</p><p class="total">Chênh lệch (${getDifferenceLabel().replace('Chênh Lệch ','')}): ${formatCurrency(difference)}</p></div><h2>Chi Tiết Mệnh Giá</h2><table class="details-table"><thead><tr><th>Mệnh Giá</th><th>Số Lượng</th><th>Thành Tiền</th></tr></thead><tbody>${denominations.map(d=>`<tr><td>${new Intl.NumberFormat('vi-VN').format(d.value)} ₫</td><td>${counts[d.value]||0}</td><td>${subtotals[d.value]?new Intl.NumberFormat('vi-VN').format(subtotals[d.value]):'0'} ₫</td></tr>`).join('')}</tbody></table><div class="footer"><p>_________________________</p><p>Chữ ký người kiểm quỹ</p></div></body></html>`;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
    }
  };
  
  const handleExportExcel = () => {
    if (savedFundChecks.length === 0) {
        alert("Không có dữ liệu lịch sử để xuất.");
        return;
    }
    const dataToExport = savedFundChecks.map(check => ({
        'Thời gian kiểm': check.checkTime.toLocaleString('vi-VN'),
        'Quỹ cần kiểm': check.targetFund,
        'Tiền lẻ': check.smallChange,
        'Quỹ cân đối': check.adjustedTargetFund,
        'Tổng tiền mặt': check.totalCash,
        'Chênh lệch': check.difference,
        ...denominations.reduce((acc, d) => ({
            ...acc,
            [`SL tờ ${formatNumber(d.value)}`]: check.counts[d.value] || 0
        }), {})
    }));
    const worksheet = window.XLSX.utils.json_to_sheet(dataToExport);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, "LichSuKiemQuy");
    const colWidths = Object.keys(dataToExport[0]).map(key => ({ wch: Math.max(key.length, 20) }));
    worksheet["!cols"] = colWidths;
    const today = new Date();
    const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
    const dateString = localDate.toISOString().split('T')[0];
    window.XLSX.writeFile(workbook, `LichSuKiemQuy_${dateString}.xlsx`);
  };
  
  const loadHistoryItem = (checkId: number) => {
    const itemToLoad = savedFundChecks.find(item => item.id === checkId);
    if (itemToLoad) {
        setCounts(itemToLoad.counts);
        setTargetFund(itemToLoad.targetFund);
        setSmallChange(itemToLoad.smallChange);
        setLastResetTime(itemToLoad.checkTime);
        setShowHistory(false);
        alert('Đã tải lại dữ liệu từ lịch sử.');
    }
  };


  // --- Kiem Ke & Kiem Tra Ton Kho Logic ---
  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = window.XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = window.XLSX.utils.sheet_to_json(worksheet, { raw: false });
        
        const loadedItems: InventoryItem[] = json.map((row: any) => {
            const imei = findValue(row, ['IMEI_1']);
            const productCode = findValue(row, ['Mã sản phẩm']);
            const productName = findValue(row, ['Tên sản phẩm']);
            const quantity = findValue(row, ['Số lượng']);
            const status = findValue(row, ['trạng thái sản phẩm']);
            const originalCategory = findValue(row, ['Ngành hàng']);
            const priceString = String(findValue(row, ['Giá bán', 'Giá']) || '0');

            const derivedCategory = getCategoryFromProductName(String(productName || ''));
            const finalCategory = derivedCategory !== 'default' 
                ? derivedCategory 
                : String(originalCategory || 'N/A');

            let rawQrCodeValue = String(imei || productCode || '').trim();
            if (rawQrCodeValue.startsWith("'")) {
              rawQrCodeValue = rawQrCodeValue.substring(1);
            }

            let rawProductCodeValue = String(productCode || '').trim();
            if (rawProductCodeValue.startsWith("'")) {
              rawProductCodeValue = rawProductCodeValue.substring(1);
            }
          
            return {
                qrCode: rawQrCodeValue,
                productCodeForSearch: rawProductCodeValue,
                productName: String(productName || 'N/A'),
                quantity: Number(String(quantity || 0).replace(/,/g, '')), // Handle formatted numbers
                price: parseFormattedNumber(priceString),
                checked: false,
                hasImei: !!imei,
                status: String(status || 'N/A'),
                category: finalCategory,
            };
        });

        const uniqueStatuses = [...new Set(loadedItems.map(item => item.status).filter(Boolean).filter(s => s !== 'N/A'))];
        const uniqueCategories = [...new Set(loadedItems.map(item => item.category).filter(Boolean).filter(c => c !== 'N/A'))];

        setAvailableStatuses(uniqueStatuses);
        setAvailableCategories(uniqueCategories);
        setInventoryItems(loadedItems);
        
        setImeiFilter('all');
        setStatusFilter('all');
        setCategoryFilter('all');
        setSearchHistory([]);
        setSearchQuery('');
        setTimeout(() => searchInputRef.current?.focus(), 100);

      } catch (error) {
        console.error("Error reading or parsing Excel file:", error);
        alert("Lỗi đọc file Excel. Hãy đảm bảo file có các cột bắt buộc: 'Tên sản phẩm', 'Số lượng'. Và các cột tùy chọn: 'IMEI_1', 'Mã sản phẩm', 'trạng thái sản phẩm', 'Ngành hàng', 'Giá bán'.");
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = ''; // Reset file input
  };
  
  const handleInventoryReset = () => {
    setInventoryItems([]);
    setFileName('');
    setImeiFilter('all');
    setStatusFilter('all');
    setCategoryFilter('all');
    setAvailableStatuses([]);
    setAvailableCategories([]);
    setSearchHistory([]);
    setSearchQuery('');
  };

  const handleCheckItem = (originalIndex: number) => {
    const newItems = inventoryItems.map((item, i) =>
        i === originalIndex ? { ...item, checked: !item.checked } : item
    );
    setInventoryItems(newItems);
  
    const futureFilteredItems = newItems
        .map((item, idx) => ({ ...item, originalIndex: idx }))
        .filter(item => {
            if (imeiFilter === 'all') return true;
            if (imeiFilter === 'with_imei') return item.hasImei;
            if (imeiFilter === 'without_imei') return !item.hasImei;
            return true;
        })
        .filter(item => {
            if (statusFilter === 'all') return true;
            return item.status === statusFilter;
        })
        .filter(item => {
            if (categoryFilter === 'all') return true;
            return item.category === categoryFilter;
        });
  
    const currentItemInFilteredList = futureFilteredItems.find(item => item.originalIndex === originalIndex);
    if (!currentItemInFilteredList) return;
    const currentFilteredIndex = futureFilteredItems.indexOf(currentItemInFilteredList);
  
    let nextUncheckedFilteredIndex = -1;
    for (let i = currentFilteredIndex + 1; i < futureFilteredItems.length; i++) {
        if (!futureFilteredItems[i].checked) {
            nextUncheckedFilteredIndex = i;
            break;
        }
    }
    if (nextUncheckedFilteredIndex === -1) {
        for (let i = 0; i < currentFilteredIndex; i++) {
            if (!futureFilteredItems[i].checked) {
                nextUncheckedFilteredIndex = i;
                break;
            }
        }
    }
  
    if (nextUncheckedFilteredIndex !== -1) {
        const nextItemToScrollTo = futureFilteredItems[nextUncheckedFilteredIndex];
        setTimeout(() => {
            const nextElement = document.getElementById(`inventory-item-${nextItemToScrollTo.originalIndex}`);
            if (nextElement) {
                nextElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }
  };

  const handleExportUncheckedItems = () => {
    const uncheckedItems = inventoryItems.filter(item => !item.checked);

    if (uncheckedItems.length === 0) {
        alert("Tất cả sản phẩm đã được kiểm tra. Không có gì để xuất.");
        return;
    }

    let totalValue = 0;

    const dataToExport = uncheckedItems.map(item => {
        const itemValue = item.quantity * item.price;
        totalValue += itemValue;
        return {
            'Tên sản phẩm': item.productName,
            'Mã sản phẩm': item.productCodeForSearch,
            'Mã QR (IMEI)': item.qrCode,
            'Số lượng': item.quantity,
            'Giá bán': item.price,
            'Thành tiền': itemValue,
            'Ngành hàng': item.category,
            'Trạng thái': item.status
        };
    });
    
    const summaryRow = {
        'Tên sản phẩm': 'TỔNG CỘNG',
        'Thành tiền': totalValue
    };

    const worksheet = window.XLSX.utils.json_to_sheet(dataToExport);

    window.XLSX.utils.sheet_add_json(worksheet, [summaryRow], {
      header: Object.keys(dataToExport[0]),
      skipHeader: true,
      origin: -1 
    });

    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, "SP_Chua_Kiem_Tra");

    const colWidths = [
      { wch: 50 }, { wch: 20 }, { wch: 20 },
      { wch: 10 }, { wch: 15 }, { wch: 15 },
      { wch: 20 }, { wch: 20 },
    ];
    worksheet["!cols"] = colWidths;

    const today = new Date();
    const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
    const dateString = localDate.toISOString().split('T')[0];
    window.XLSX.writeFile(workbook, `SP_ChuaKiem_${dateString}.xlsx`);
  };

  const filteredInventoryItems = useMemo(() => {
    return inventoryItems
        .map((item, index) => ({ ...item, originalIndex: index }))
        .filter(item => {
            if (imeiFilter === 'all') return true;
            if (imeiFilter === 'with_imei') return item.hasImei;
            if (imeiFilter === 'without_imei') return !item.hasImei;
            return true;
        })
        .filter(item => {
            if (statusFilter === 'all') return true;
            return item.status === statusFilter;
        })
        .filter(item => {
            if (categoryFilter === 'all') return true;
            return item.category === categoryFilter;
        });
  }, [inventoryItems, imeiFilter, statusFilter, categoryFilter]);

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const query = searchQuery.trim().toLowerCase();
    
    let foundItem = inventoryItems.find(item => 
        (item.qrCode && String(item.qrCode).trim().toLowerCase() === query) ||
        (item.productCodeForSearch && String(item.productCodeForSearch).trim().toLowerCase() === query)
    );

    if (!foundItem) {
        const nameMatches = inventoryItems.filter(item =>
            item.productName.toLowerCase().includes(query)
        );
        if (nameMatches.length > 0) {
            foundItem = nameMatches[0];
        }
    }

    setSearchHistory(prev => [{ query: searchQuery.trim(), result: foundItem || null }, ...prev]);
    setSearchQuery('');
    setIsSuggestionsVisible(false);
  };
  
  const handleSuggestionClick = (item: InventoryItem) => {
    setSearchHistory(prev => [{ query: item.productName, result: item }, ...prev]);
    setSearchQuery('');
    setIsSuggestionsVisible(false);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  // --- Kiem Hang Chuyen Kho Logic ---
  const handleFileImportForExcelCheck = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setExcelCheckFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = window.XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json = window.XLSX.utils.sheet_to_json(worksheet, { raw: false });

            const loadedItems: ExcelCheckItem[] = json.map((row: any) => {
                let productCode = String(findValue(row, ['Mã sản phẩm']) || 'N/A').trim();
                if (productCode.startsWith("'")) {
                    productCode = productCode.substring(1);
                }
                const productName = findValue(row, ['Tên sản phẩm']);
                const quantity = findValue(row, ['Số lượng']);
                let imei = findValue(row, ['IMEI_1']);
                if (imei) {
                    imei = String(imei).trim();
                    if (imei.startsWith("'")) {
                        imei = imei.substring(1);
                    }
                }
                const originalCategory = findValue(row, ['Ngành hàng']);
                const derivedCategory = getCategoryFromProductName(String(productName || ''));
                const finalCategory = derivedCategory !== 'default'
                    ? derivedCategory
                    : String(originalCategory || 'N/A');
              
                return {
                    productCode: productCode,
                    productName: String(productName || 'N/A'),
                    fileQuantity: Number(String(quantity || 0).replace(/,/g, '')),
                    actualQuantity: null,
                    imei: imei ? imei : undefined,
                    category: finalCategory,
                };
            });
            setExcelCheckItems(loadedItems);
            setScanStatus({ type: 'idle', message: 'Sẵn sàng quét...' });
            setTimeout(() => scanInputRef.current?.focus(), 100);
        } catch (error) {
            console.error("Error reading or parsing Excel file:", error);
            alert("Lỗi đọc file Excel. Hãy đảm bảo file có các cột bắt buộc: 'Tên sản phẩm', 'Số lượng'. Và các cột tùy chọn: 'Mã sản phẩm', 'IMEI_1', 'Ngành hàng'.");
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };
  
  const handleScanSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = scanQuery.trim();
    if (!query) return;

    // Sanitize query from Excel (which might have "'" prefix)
    const sanitizedQuery = (query.startsWith("'") ? query.substring(1) : query).toLowerCase();

    let foundIndex = -1;
    
    // Sanitize item data on-the-fly for comparison
    const cleanString = (str: string | undefined) => {
        if (!str) return '';
        let cleaned = String(str).trim();
        if (cleaned.startsWith("'")) {
            cleaned = cleaned.substring(1);
        }
        return cleaned.toLowerCase();
    };

    // Prioritize search by product code first
    foundIndex = excelCheckItems.findIndex(item => cleanString(item.productCode) === sanitizedQuery);

    // If not found, search by IMEI
    if (foundIndex === -1) {
        foundIndex = excelCheckItems.findIndex(item => cleanString(item.imei) === sanitizedQuery);
    }
    
    if (foundIndex !== -1) {
        const newItems = [...excelCheckItems];
        const itemToUpdate = newItems[foundIndex];
        itemToUpdate.actualQuantity = (itemToUpdate.actualQuantity || 0) + 1;
        setExcelCheckItems(newItems);
        setScanStatus({type: 'success', message: `Đã cập nhật: ${itemToUpdate.productName}`});
        setLastScannedIndex(foundIndex);
        setTimeout(() => setLastScannedIndex(null), 1000); // Highlight for 1 second

    } else {
        setScanStatus({type: 'error', message: `Không tìm thấy sản phẩm với mã: ${query}`});
    }

    setScanQuery(''); // Clear input for next scan
};


  const handleExcelCheckReset = () => {
    setExcelCheckItems([]);
    setExcelCheckFileName('');
    setScanQuery('');
    setScanStatus({ type: 'idle', message: 'Sẵn sàng quét...' });
  };

  const handleActualQuantityChange = (index: number, value: string) => {
      const newItems = [...excelCheckItems];
      const numberValue = parseInt(value, 10);
      newItems[index].actualQuantity = isNaN(numberValue) || numberValue < 0 ? null : numberValue;
      setExcelCheckItems(newItems);
  };

  const excelCheckStats = useMemo(() => {
    return excelCheckItems.reduce((acc, item) => {
        acc.totalFileQuantity += item.fileQuantity;
        if (item.actualQuantity !== null) {
            acc.totalActualQuantity += item.actualQuantity;
            const difference = item.actualQuantity - item.fileQuantity;
            if (difference === 0) {
                acc.matchedCount++;
            } else {
                acc.mismatchedCount++;
            }
        }
        return acc;
    }, { totalFileQuantity: 0, totalActualQuantity: 0, matchedCount: 0, mismatchedCount: 0 });
  }, [excelCheckItems]);
  
  const mismatchedItems = useMemo(() => {
    return excelCheckItems.filter(item => item.actualQuantity !== null && item.actualQuantity !== item.fileQuantity);
  }, [excelCheckItems]);

  const handleExportExcelCheckResult = () => {
    if (excelCheckItems.length === 0) {
        alert("Không có dữ liệu để xuất.");
        return;
    }

    const dataToExport = excelCheckItems.map(item => {
        const difference = item.actualQuantity === null ? '' : item.actualQuantity - item.fileQuantity;
        let status = 'Chưa kiểm';
        if (item.actualQuantity !== null) {
            if (difference === 0) status = 'Khớp';
            else if (Number(difference) > 0) status = `Thừa ${difference}`;
            else status = `Thiếu ${Math.abs(Number(difference))}`;
        }
        return {
            'Mã sản phẩm': item.productCode,
            'Tên sản phẩm': item.productName,
            'IMEI': item.imei || '',
            'Số lượng (File)': item.fileQuantity,
            'Số lượng (Thực tế)': item.actualQuantity ?? '',
            'Chênh lệch': difference,
            'Trạng thái': status,
        };
    });

    const worksheet = window.XLSX.utils.json_to_sheet(dataToExport);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, "KetQuaKiemHang");
    
    worksheet["!cols"] = [{ wch: 20 }, { wch: 50 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
    
    const today = new Date();
    const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
    const dateString = localDate.toISOString().split('T')[0];
    window.XLSX.writeFile(workbook, `KetQuaKiemHang_${dateString}.xlsx`);
  };

  const handleExcelCheckKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, currentIndex: number) => {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = currentIndex + 1;
        if (nextIndex < excelCheckItems.length) {
            const nextInput = document.getElementById(`excel-check-item-${nextIndex}`);
            nextInput?.focus();
        }
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prevIndex = currentIndex - 1;
        if (prevIndex >= 0) {
            const prevInput = document.getElementById(`excel-check-item-${prevIndex}`);
            prevInput?.focus();
        }
    }
  };

  // --- Tinh Thuong Logic ---
  const handleBonusImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files.length > 0) {
          setBonusImages(Array.from(event.target.files));
      }
  };

  const handleAnalyzeBonus = async () => {
      if (bonusImages.length === 0) {
          alert("Vui lòng chọn ít nhất một hình ảnh để phân tích.");
          return;
      }

      setIsAnalyzingBonus(true);
      setBonusAnalysisProgress({ status: 'Khởi tạo...', progress: 0 });
      setBonusItems([]);
      setExcludedBonusIndices([]);

      const allFoundItems: BonusItem[] = [];

      // A set of keywords to validate if a line is a bonus/allowance item
      const validationKeywords = [/thưởng/i, /trợ\s*cấp/i, /khoán/i, /pc/i, /kpi/i, /incentive/i, /phụ\s*cấp/i, /lương/i];

      const parseTextForBonuses = (text: string) => {
          const lines = text.split('\n');
          lines.forEach(line => {
              const cleanedLine = line.trim();
              if (cleanedLine.length < 5) return; // Ignore very short/empty lines

              // Regex to find all numbers that look like currency (e.g., 1.000.000 or 100,000)
              const currencyRegex = /(\d{1,3}(?:[.,]\d{3})*)/g;
              const matches = [...cleanedLine.matchAll(currencyRegex)];

              if (matches.length > 0) {
                  // Assume the LAST number found on the line is the relevant amount
                  const lastMatch = matches[matches.length - 1];
                  const amountString = lastMatch[0];
                  const amount = parseInt(amountString.replace(/[.,]/g, ''), 10);

                  // The index where the amount string starts
                  const amountIndex = lastMatch.index!;

                  // Validate the parsed amount is a reasonable value for a bonus
                  if (!isNaN(amount) && amount >= 1000) {
                      // The description is the full line with the last occurrence of the amount string removed.
                      // This preserves all original text, including notes or details.
                      const fullDescription = (
                          cleanedLine.substring(0, amountIndex) + 
                          cleanedLine.substring(amountIndex + amountString.length)
                      ).trim().replace(/\s\s+/g, ' '); // Clean up extra spaces

                      // Check if the resulting description is meaningful and contains a keyword
                      if (fullDescription.length > 2 && validationKeywords.some(kw => kw.test(fullDescription))) {
                          allFoundItems.push({ 
                              description: fullDescription,
                              amount 
                          });
                      }
                  }
              }
          });
      };


      try {
          const worker = await window.Tesseract.createWorker('vie', 1, {
              logger: (m: any) => {
                  if (m.status === 'recognizing text') {
                      setBonusAnalysisProgress(prev => ({ ...(prev!), progress: Math.round(m.progress * 100) }));
                  }
              }
          });

          for (let i = 0; i < bonusImages.length; i++) {
              const file = bonusImages[i];
              setBonusAnalysisProgress({ status: `Xử lý ảnh ${i + 1}/${bonusImages.length}`, progress: 0 });
              const { data: { text } } = await worker.recognize(file);
              parseTextForBonuses(text);
          }

          await worker.terminate();
          setBonusItems(allFoundItems);
          if(allFoundItems.length === 0){
               alert("Không tìm thấy khoản thưởng nào hợp lệ trong ảnh. Vui lòng kiểm tra lại hình ảnh hoặc thử với ảnh rõ nét hơn.");
          }

      } catch (error) {
          console.error("Tesseract OCR Error:", error);
          alert("Đã xảy ra lỗi trong quá trình nhận diện hình ảnh. Vui lòng thử lại.");
      } finally {
          setIsAnalyzingBonus(false);
          setBonusAnalysisProgress(null);
      }
  };

  const activeBonusItems = useMemo(() => {
      return bonusItems.filter((_, idx) => !excludedBonusIndices.includes(idx));
  }, [bonusItems, excludedBonusIndices]);

  const totalBonus = useMemo(() => activeBonusItems.reduce((acc, item) => acc + item.amount, 0), [activeBonusItems]);
  
  const managerShare = Math.round(totalBonus * 0.3);
  const staffShare = totalBonus - managerShare;
  const actualStaffShare = staffShare - bonusDeduction;
  
    const staffMembers = [
        { name: "Đào Thế Anh", account: "031119939", bank: "MB" },
        { name: "Du Thanh Phong", account: "TAIKHOAN_PHONG", bank: "MB" },
        { name: "Đào Thị Thu Hiền", account: "TAIKHOAN_HIEN", bank: "MB" }
    ];
  const perStaffShare = staffMembers.length > 0 ? Math.round(actualStaffShare / staffMembers.length) : 0;

  const toggleBonusItem = (index: number) => {
      setExcludedBonusIndices(prev => {
          if (prev.includes(index)) {
              return prev.filter(i => i !== index); // Include it back
          } else {
              return [...prev, index]; // Exclude it
          }
      });
  };

  const handleBonusDeductionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setBonusDeduction(parseFormattedNumber(e.target.value));
  };

  // --- Thay POSM Logic ---
  const handlePosmFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPosmFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = window.XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        const rows: any[][] = window.XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

        if (rows.length < 1) {
             alert("File Excel trống hoặc không có dữ liệu.");
             return;
        }

        let productNameIndex = -1;
        let productCodeIndex = -1;
        let oldPriceIndex = -1;
        let newPriceIndex = -1;
        let promotionIndex = -1;
        let headerRowIndex = -1;
        let dataStartIndex = 0;

        // --- Auto-detection Algorithm v2 ---
        // Tìm dòng tiêu đề bằng cách quét các từ khóa
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
            const rowStr = rows[i].map(c => String(c).toLowerCase().trim());
            const hasName = rowStr.some(c => /tên\s*(sản\s*phẩm|hàng|sp)|product\s*name|description|diễn\s*giải/i.test(c));
            const hasPrice = rowStr.some(c => /giá/i.test(c));
            
            if (hasName && hasPrice) {
                headerRowIndex = i;
                break;
            }
        }

        if (headerRowIndex !== -1) {
            const header = rows[headerRowIndex].map(c => String(c).toLowerCase().trim());
            
            // Regex patterns
            const nameRegex = /tên\s*(sản\s*phẩm|hàng|sp)|product\s*name|description|diễn\s*giải/i;
            const codeRegex = /mã\s*(sản\s*phẩm|sp|hàng)|product\s*code|sku|model/i;
            
            // Tránh nhầm lẫn "Giá treo", "Giá đỡ"
            const excludeRegex = /treo|đỡ|kệ/i; 

            const oldPriceRegex = /giá\s*(gốc|cũ|niêm\s*yết|bìa|trước\s*giảm)|old\s*price/i;
            const newPriceRegex = /giá\s*(mới|bán|km|khuyến\s*mãi|thu|sau\s*giảm)|new\s*price|thực\s*thu/i;
            
            // Nếu chỉ có chữ "Giá" chung chung
            const genericPriceRegex = /^giá$|price|^giá\s*bán$/i;

            const promotionRegex = /khuyến\s*mãi|quà\s*tặng|promotion|ctkm/i;

            // Scoring mechanism for prices
            let bestOldPriceIdx = -1;
            let bestNewPriceIdx = -1;
            
            header.forEach((colName, idx) => {
                if (nameRegex.test(colName) && productNameIndex === -1) productNameIndex = idx;
                if (codeRegex.test(colName) && productCodeIndex === -1) productCodeIndex = idx;
                if (promotionRegex.test(colName) && !/giá/i.test(colName) && promotionIndex === -1) promotionIndex = idx;
                
                // Skip if excluded
                if (excludeRegex.test(colName)) return;

                if (oldPriceRegex.test(colName)) bestOldPriceIdx = idx;
                if (newPriceRegex.test(colName)) bestNewPriceIdx = idx;
            });
            
            // Fallback logic if specific regex didn't match
            if (bestOldPriceIdx === -1 && bestNewPriceIdx === -1) {
                 // Tìm tất cả cột có chữ "giá"
                 const priceIndices = header.map((h, i) => (h.includes('giá') && !excludeRegex.test(h) ? i : -1)).filter(i => i !== -1);
                 if (priceIndices.length >= 2) {
                     // Giả định cột giá đầu tiên là Giá Gốc, cột sau là Giá Mới (thường thấy trong file excel)
                     bestOldPriceIdx = priceIndices[0];
                     bestNewPriceIdx = priceIndices[1];
                 } else if (priceIndices.length === 1) {
                     // Nếu chỉ có 1 cột giá, đó là giá bán (New Price)
                     bestNewPriceIdx = priceIndices[0];
                 }
            }

            oldPriceIndex = bestOldPriceIdx;
            newPriceIndex = bestNewPriceIdx;
            
            // Final check: if we found New Price but no Old Price, maybe New Price IS the price
            if (newPriceIndex !== -1 && oldPriceIndex === -1) {
                // Old Price can be 0 or same as New Price later in logic
            }

            // Fix for common files where "Giá bán" is meant to be current price
            if (newPriceIndex === -1 && oldPriceIndex !== -1) {
                newPriceIndex = oldPriceIndex; // Swap if logic failed
                oldPriceIndex = -1;
            }
            
            // Fallback for Code if not found: Next to Name
            if (productCodeIndex === -1 && productNameIndex !== -1) {
                 productCodeIndex = productNameIndex + 1;
            }

            dataStartIndex = headerRowIndex + 1;
        } else {
            // Fallback to hardcoded columns if no header found (Legacy support)
            productNameIndex = 25; // Z
            productCodeIndex = 26; // AA
            oldPriceIndex = 15;   // P
            newPriceIndex = 16;   // Q
            promotionIndex = 29; // AD
            dataStartIndex = 0; 
        }

        // Parse data
        const loadedItems: PosmChangeItem[] = [];
        for (let i = dataStartIndex; i < rows.length; i++) {
            const row = rows[i];
            
            if (row.length === 0 || productNameIndex === -1 || !row[productNameIndex]) {
                continue;
            }

            const productName = String(row[productNameIndex]).trim();
            if (productName === '' || productName.toLowerCase() === 'tên sản phẩm') continue;

            const productCode = (productCodeIndex !== -1 && row[productCodeIndex]) ? String(row[productCodeIndex]).trim() : `POSM-${i}`;
            const oldPriceString = (oldPriceIndex !== -1 && row[oldPriceIndex]) ? String(row[oldPriceIndex]) : '0';
            const newPriceString = (newPriceIndex !== -1 && row[newPriceIndex]) ? String(row[newPriceIndex]) : '0';
            const promotionText = (promotionIndex !== -1 && row[promotionIndex]) ? String(row[promotionIndex]).trim() : '';

            // Extract bonus point
            let bonusPoint = undefined;
            const codeParts = productCode.split('-');
            if (codeParts.length > 1) {
                const bonusPart = codeParts[1];
                if (bonusPart && bonusPart.length >= 5) {
                    const potentialBonus = bonusPart.substring(4);
                    const match = potentialBonus.match(/\d{2,3}/);
                    if (match) bonusPoint = match[0];
                }
            }
            
            loadedItems.push({
                productName,
                productCode,
                oldPrice: parseFormattedNumber(oldPriceString),
                newPrice: parseFormattedNumber(newPriceString),
                promotion: promotionText,
                bonusPoint: bonusPoint,
            });
        }
        
        if (loadedItems.length === 0) {
            alert("Không tìm thấy dữ liệu sản phẩm hợp lệ. Vui lòng kiểm tra lại file Excel.");
            setPosmItems([]);
        } else {
            setPosmItems(loadedItems);
        }
        setSelectedPosmItems([]);

      } catch (error) {
        console.error("Error reading or parsing Excel file for POSM:", error);
        alert("Đã xảy ra lỗi khi xử lý file Excel. Vui lòng đảm bảo file không bị lỗi.");
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };
    
  const handlePosmReset = () => {
    setPosmItems([]);
    setPosmFileName('');
    setSelectedPosmItems([]);
  };

  const handlePosmSelect = (productCode: string) => {
    setSelectedPosmItems(prev =>
        prev.includes(productCode)
            ? prev.filter(code => code !== productCode)
            : [...prev, productCode]
    );
  };

  const handlePosmSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.checked) {
          setSelectedPosmItems(posmItems.map(item => item.productCode));
      } else {
          setSelectedPosmItems([]);
      }
  };

  const handlePrintPosm = async (format: 'a5-2' | 'a6-2') => {
    const itemsToPrint = posmItems.filter(item => selectedPosmItems.includes(item.productCode));
    if (itemsToPrint.length === 0) {
        alert("Vui lòng chọn ít nhất một sản phẩm để in.");
        return;
    }

    const qrCodePromises = itemsToPrint.map(item => 
        window.QRCode.toDataURL(item.productCode.split('-')[0], { width: 120, margin: 1, errorCorrectionLevel: 'medium' })
    );
    const qrCodeDataUrls = await Promise.all(qrCodePromises);
    const itemsWithQr = itemsToPrint.map((item, index) => ({...item, qrDataUrl: qrCodeDataUrls[index] }));

    let formatSpecificStyles = '';
    let pageClasses = 'page';
    let cardClasses = 'posm-card';

    if (format === 'a5-2') {
         formatSpecificStyles = `
            @page { 
                size: A4 portrait;
                margin: 0; 
            }
            .page { 
                width: 210mm; 
                height: 297mm;
                justify-content: flex-start;
            }
            .posm-card {
                width: 210mm;
                height: 148mm;
                border-bottom: 1px solid #eee;
            }
            .page .posm-card:last-child {
                border-bottom: none;
            }
         `;
    } else { // 'a6-2'
         pageClasses += ' a5-page';
         cardClasses += ' a6';
         formatSpecificStyles = `
            @page { 
                size: A5 portrait;
                margin: 0; 
            }
            .page.a5-page { 
                width: 148.5mm; 
                height: 210mm;
                justify-content: flex-start;
            }
            .posm-card.a6 {
                width: 148.5mm;
                height: 105mm;
                padding: 4mm;
            }
            .page.a5-page .posm-card.a6:first-of-type:not(:last-of-type) {
                border-bottom: 1px dashed #ccc;
            }
            .posm-card.a6 .header-main-info {
                 min-height: 48px;
                 padding-right: 5px;
            }
            .posm-card.a6 .product-name {
                font-size: 0.95em;
                line-height: 1.2;
                -webkit-line-clamp: 3;
            }
            .posm-card.a6 .promotion-text {
                font-size: 1.05em;
                margin-top: 3px;
                line-height: 1.2;
                -webkit-line-clamp: 2;
            }
            .posm-card.a6 .promotion-block {
                font-size: 1.4em;
                -webkit-line-clamp: 3;
                margin-bottom: 0.25em;
                padding: 0 5px;
            }
             .posm-card.a6 .promotion-block.promotion-only {
                font-size: 2.5em;
                -webkit-line-clamp: 5;
            }
            .posm-card.a6 .price-block.primary .price-label {
                font-size: 1.8em;
            }
            .posm-card.a6 .price-block.primary .price-value {
                font-size: 4.4em;
            }
            .posm-card.a6 .price-block.secondary .price-label {
                font-size: 1.5em;
            }
            .posm-card.a6 .price-block.secondary .price-value {
                font-size: 3.8em;
            }
            .posm-card.a6 .posm-body {
                padding: 1px 0;
            }
            .posm-card.a6 .qr-code-container img {
                width: 42px;
                height: 42px;
            }
            .posm-card.a6 .product-code {
                font-size: 1.05em;
            }
         `;
    }

    const cssStyles = `
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
            @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0,0');
            body { 
                margin: 0; 
                font-family: 'Inter', sans-serif;
                background-color: #fff;
            }
            .page { 
                page-break-after: always;
                box-sizing: border-box; 
                display: flex;
                flex-direction: column;
                align-items: center;
                overflow: hidden;
            }
            
            .material-symbols-outlined {
                font-variation-settings: 'FILL' 0, 'wght' 600, 'GRAD' 0, 'opsz' 48;
                line-height: 1;
                vertical-align: middle;
                font-feature-settings: 'liga';
                -webkit-font-smoothing: antialiased;
            }
            
            ${formatSpecificStyles}

            .posm-card {
                box-sizing: border-box;
                padding: 5mm;
                background: #fff;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                position: relative;
                flex-shrink: 0;
            }
            
            .separator {
                border: none;
                border-top: 2px solid #111;
                margin: 0;
                flex-shrink: 0;
            }

            .posm-header {
                padding: 10px 15px;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                flex-shrink: 0;
            }
            .header-main-info {
                flex-grow: 1;
                padding-right: 10px;
                min-height: 80px;
            }
            .product-name-container {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .category-icon {
                 font-size: 1.2em;
                 display: inline-block;
                 flex-shrink: 0;
                 color: #333;
            }
            .product-name {
                 font-size: 1.6em;
                 font-weight: 800;
                 color: #000;
                 line-height: 1.2;
                 word-break: break-word;
                 display: -webkit-box;
                 -webkit-line-clamp: 3;
                 -webkit-box-orient: vertical;
                 overflow: hidden;
                 text-overflow: ellipsis;
            }
            .promotion-text {
                font-size: 1.4em;
                font-weight: 500;
                color: #4b5563;
                margin-top: 6px;
                line-height: 1.2;
                word-break: break-word;
                display: flex;
                align-items: center;
                gap: 6px;
                -webkit-box-orient: vertical;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .promotion-text > span {
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .gift-icon {
                font-size: 1.1em;
                display: inline-block;
                flex-shrink: 0;
                color: #4b5563;
            }
            .posm-body {
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                padding: 5px 0;
                text-align: center;
                overflow: hidden;
            }
            .promotion-block {
                font-size: 1.8em;
                font-weight: 800;
                color: #111;
                padding: 0 10px;
                text-align: center;
                line-height: 1.25;
                word-break: break-word;
                margin-bottom: 0.5em;
                display: -webkit-box;
                -webkit-line-clamp: 4;
                -webkit-box-orient: vertical;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .promotion-block.promotion-only {
                font-size: 3.4em;
                margin-bottom: 0;
                -webkit-line-clamp: 5;
                flex-grow: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 15px;
            }
            .promotion-block.promotion-only .gift-icon {
                font-size: 1em;
            }
            .price-block {
                margin-bottom: 0.5em;
            }
            .price-block:last-child {
                margin-bottom: 0;
            }
            .price-label {
                font-weight: 800;
                color: #111;
                display: block;
                line-height: 1;
            }
             .price-value {
                font-weight: 800;
                color: #111;
                line-height: 1;
                white-space: nowrap;
            }
            
            .price-block.primary .price-label { font-size: 2.8em; }
            .price-block.primary .price-value { font-size: 6.5em; }

            .price-block.secondary .price-label { font-size: 2em; }
            .price-block.secondary .price-value { font-size: 5em; }

            .posm-footer {
                padding: 8px 15px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background-color: #f8f9fa;
                flex-shrink: 0;
            }
            .footer-info { font-size: 0.8em; color: #555; }
            .product-code { 
                font-weight: 800;
                font-size: 1.2em;
            }
            .print-date { }
            .qr-code-container img { width: 50px; height: 50px; display: block; }

            @media print {
                body {
                    -webkit-print-color-adjust: exact; 
                    print-color-adjust: exact;
                }
            }
        </style>
    `;

    const itemsPerPage = 2;

    let content = '';
    for (let i = 0; i < itemsWithQr.length; i += itemsPerPage) {
        const pageItems = itemsWithQr.slice(i, i + itemsPerPage);
        
        content += `<div class="${pageClasses}">`;
        pageItems.forEach(item => {
            const priceDifference = item.oldPrice - item.newPrice;
            const parsedProductName = parseProductNameForPosm(item.productName);
            const productNameWithBonus = parsedProductName + (item.bonusPoint ? ` (${item.bonusPoint})` : '');
            
            const category = getCategoryFromProductName(item.productName);
            const categoryIconSvg = getIconSvg(category, 'category-icon');
            const giftIconSvg = getIconSvg('gift', 'gift-icon');

            let promotionTextOnly = '';
            if (item.promotion) {
                const originalPromotion = item.promotion;
                const separatorIndex = originalPromotion.toLowerCase().indexOf("hoặc");
                if (separatorIndex !== -1) {
                    promotionTextOnly = originalPromotion.substring(0, separatorIndex).trim();
                } else {
                    promotionTextOnly = originalPromotion;
                }
                promotionTextOnly = promotionTextOnly.replace(/^-/, '').trim();
            }
            
            const showPromotionInHeader = priceDifference > 0 && !!promotionTextOnly;
            const showPromotionInBody = priceDifference <= 0 && !!promotionTextOnly;


            content += `
                <div class="${cardClasses}">
                    <div class="posm-header">
                        <div class="header-main-info">
                            <div class="product-name-container">
                                ${categoryIconSvg}
                                <div class="product-name">${productNameWithBonus}</div>
                            </div>
                            ${showPromotionInHeader ? `<div class="promotion-text">${giftIconSvg}<span>Khuyến mãi: ${promotionTextOnly}</span></div>` : ''}
                        </div>
                    </div>
                    <hr class="separator" />
                    <div class="posm-body">
                        ${priceDifference > 0 ? `
                            <div class="price-block primary">
                                <span class="price-label">GIẢM</span>
                                <span class="price-value">${formatCurrency(priceDifference)}</span>
                            </div>
                            <div class="price-block secondary">
                                <span class="price-label">CHỈ CÒN</span>
                                <span class="price-value">${formatCurrency(item.newPrice)}</span>
                            </div>
                        ` : (showPromotionInBody ? `
                            <div class="promotion-block promotion-only">
                               ${giftIconSvg}
                               <span>${promotionTextOnly}</span>
                            </div>
                        ` : `
                            <div class="price-block secondary">
                                <span class="price-label">GIÁ BÁN</span>
                                <span class="price-value">${formatCurrency(item.newPrice)}</span>
                            </div>
                        `)}
                    </div>
                    <hr class="separator" />
                    <div class="posm-footer">
                        <div class="footer-info">
                            <div class="product-code">Mã SP: ${item.productCode.split('-')[0]}</div>
                            <div class="print-date">In ngày: ${new Date().toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                        <div class="qr-code-container">
                            <img src="${item.qrDataUrl}" alt="QR Code" />
                        </div>
                    </div>
                </div>
            `;
        });
        content += '</div>';
    }

    const fullHtml = `<html><head><title>In POSM</title>${cssStyles}</head><body>${content}</body></html>`;
    
    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(fullHtml);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
        }, 500);
    }
  };

  const handlePrintBarcode = () => {
      if (!qrGeneratorText) return;
      
      const printContent = `
        <html>
            <head>
                <title>In Mã Vạch</title>
                <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
                <style>
                    body { display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .barcode-container { text-align: center; }
                </style>
            </head>
            <body>
                <div class="barcode-container">
                    <svg id="barcode"></svg>
                </div>
                <script>
                    JsBarcode("#barcode", "${qrGeneratorText}", {
                        format: "CODE128",
                        lineColor: "#000",
                        width: 2,
                        height: 100,
                        displayValue: true,
                        fontSize: 20
                    });
                    window.onload = function() { window.print(); }
                </script>
            </body>
        </html>
      `;
      
      const printWindow = window.open('', '_blank');
      if (printWindow) {
          printWindow.document.open();
          printWindow.document.write(printContent);
          printWindow.document.close();
      }
  };


  // --- Navigation & Rendering ---
  const navItemClasses = (page: Page) => 
    `flex items-center gap-2 px-3 py-2 rounded-md font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-white ${
        currentPage === page ? 'bg-indigo-100 text-indigo-700' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
    }`;
    
  const renderContent = () => {
    
    switch (currentPage) {
      case 'trang-chu':
        return (
          <div className="w-full max-w-7xl mx-auto flex flex-col items-center justify-center flex-grow pb-24">
             <h1 className="text-6xl sm:text-7xl font-extrabold text-slate-900 tracking-wide text-center">TRANG HỖ TRỢ CÔNG VIỆC</h1>
             <div className="mt-12 w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 text-center">
                
                <div onClick={() => handleFeatureClick('kiem-quy')} className="group bg-white p-6 py-8 rounded-2xl shadow-sm border border-slate-200/80 hover:border-blue-500 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col items-center justify-center">
                    <div className="flex-shrink-0 bg-blue-100 text-blue-600 rounded-full w-20 h-20 flex items-center justify-center mb-5 transition-colors duration-300 group-hover:bg-blue-200">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    </div>
                    <h2 className="text-base font-bold text-slate-800 group-hover:text-blue-600 transition-colors duration-300">Kiểm Quỹ Thu Ngân</h2>
                </div>

                <div onClick={() => handleFeatureClick('kiem-ke')} className="group bg-white p-6 py-8 rounded-2xl shadow-sm border border-slate-200/80 hover:border-green-500 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col items-center justify-center">
                    <div className="flex-shrink-0 bg-green-100 text-green-600 rounded-full w-20 h-20 flex items-center justify-center mb-5 transition-colors duration-300 group-hover:bg-green-200">
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                    </div>
                    <h2 className="text-base font-bold text-slate-800 group-hover:text-green-600 transition-colors duration-300">Kiểm Kê Hàng Hóa</h2>
                </div>
                
                <div onClick={() => handleFeatureClick('kiem-tra-ton-kho')} className={`group bg-white p-6 py-8 rounded-2xl shadow-sm border border-slate-200/80 transition-all duration-300 cursor-pointer flex flex-col items-center justify-center ${isFeatureLocked('kiem-tra-ton-kho') ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:border-amber-500 hover:shadow-xl hover:-translate-y-1'}`}>
                    <div className="flex-shrink-0 bg-amber-100 text-amber-600 rounded-full w-20 h-20 flex items-center justify-center mb-5 transition-colors duration-300 group-hover:bg-amber-200">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    </div>
                    <h2 className="text-base font-bold text-slate-800 group-hover:text-amber-600 transition-colors duration-300">Kiểm Tra Tồn Kho</h2>
                </div>

                <div onClick={() => handleFeatureClick('kiem-hang-chuyen-kho')} className={`group bg-white p-6 py-8 rounded-2xl shadow-sm border border-slate-200/80 transition-all duration-300 cursor-pointer flex flex-col items-center justify-center ${isFeatureLocked('kiem-hang-chuyen-kho') ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:border-cyan-500 hover:shadow-xl hover:-translate-y-1'}`}>
                    <div className="flex-shrink-0 bg-cyan-100 text-cyan-600 rounded-full w-20 h-20 flex items-center justify-center mb-5 transition-colors duration-300 group-hover:bg-cyan-200">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <h2 className="text-base font-bold text-slate-800 group-hover:text-cyan-600 transition-colors duration-300">Kiểm Hàng Chuyển Kho</h2>
                </div>
                
                <div onClick={() => handleFeatureClick('thay-posm')} className={`group bg-white p-6 py-8 rounded-2xl shadow-sm border border-slate-200/80 transition-all duration-300 cursor-pointer flex flex-col items-center justify-center ${isFeatureLocked('thay-posm') ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:border-purple-500 hover:shadow-xl hover:-translate-y-1'}`}>
                    <div className="flex-shrink-0 bg-purple-100 text-purple-600 rounded-full w-20 h-20 flex items-center justify-center mb-5 transition-colors duration-300 group-hover:bg-purple-200">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <h2 className="text-base font-bold text-slate-800 group-hover:text-purple-600 transition-colors duration-300">Thay POSM</h2>
                </div>
                
                <div onClick={() => handleFeatureClick('ma-qr')} className={`group bg-white p-6 py-8 rounded-2xl shadow-sm border border-slate-200/80 transition-all duration-300 cursor-pointer flex flex-col items-center justify-center ${isFeatureLocked('ma-qr') ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:border-slate-500 hover:shadow-xl hover:-translate-y-1'}`}>
                    <div className="flex-shrink-0 bg-slate-100 text-slate-600 rounded-full w-20 h-20 flex items-center justify-center mb-5 transition-colors duration-300 group-hover:bg-slate-200">
                        <span className="material-symbols-outlined" style={{ fontSize: '40px' }}>qr_code_2</span>
                    </div>
                    <h2 className="text-base font-bold text-slate-800 group-hover:text-slate-600 transition-colors duration-300">Tạo Mã QR / Barcode</h2>
                </div>

             </div>
          </div>
        );
      case 'kiem-quy':
        return (
          <>
            {showHistory && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => setShowHistory(false)}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <header className="p-5 border-b border-slate-200 flex justify-between items-center flex-shrink-0">
                            <h2 className="text-xl font-bold text-slate-800">Lịch Sử Kiểm Quỹ</h2>
                            <button onClick={() => setShowHistory(false)} className="text-slate-500 hover:text-slate-800 transition-colors rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </header>
                        <main className="p-6 overflow-y-auto">
                            {savedFundChecks.length > 0 ? (
                                <div className="space-y-4">
                                    {savedFundChecks.map(item => {
                                        const diffColor = item.difference === 0 ? 'text-green-600' : item.difference > 0 ? 'text-amber-600' : 'text-red-600';
                                        return (
                                        <div key={item.id} className="bg-slate-50 border border-slate-200/80 rounded-lg p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                            <div>
                                                <p className="font-semibold text-slate-800">Thời gian: <span className="font-normal text-slate-600">{item.checkTime.toLocaleString('vi-VN')}</span></p>
                                                <p className="font-semibold text-slate-800">Tổng tiền mặt: <span className="font-mono text-indigo-600 font-bold">{formatCurrency(item.totalCash)}</span></p>
                                                <p className={`font-semibold ${diffColor}`}>Chênh lệch: <span className="font-mono font-bold">{formatCurrency(item.difference)}</span></p>
                                            </div>
                                            <button onClick={() => loadHistoryItem(item.id)} className="flex-shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-white text-slate-700 border border-slate-300 font-semibold rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400 focus:ring-offset-white transition-colors duration-200 text-xs">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7V9a1 1 0 01-2 0V3a1 1 0 011-1zm12 14a1 1 0 01-1 1v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 111.885-.666A5.002 5.002 0 0014.001 13v-2a1 1 0 012 0v5a1 1 0 01-1 1z" clipRule="evenodd" /></svg>
                                                Tải Lại
                                            </button>
                                        </div>
                                    )})}
                                </div>
                            ) : (
                                <div className="text-center py-10">
                                    <p className="text-slate-500">Chưa có lịch sử nào được lưu.</p>
                                </div>
                            )}
                        </main>
                    </div>
                </div>
            )}
            <div className="w-full max-w-7xl mx-auto">
              <header className="text-center mb-8">
                  <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">KIỂM QUỸ THU NGÂN</h1>
                  <div className="mt-4 flex flex-wrap justify-center items-center gap-3">
                    <button id="save-button" onClick={handleSave} className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 focus:ring-offset-white transition-colors duration-200 text-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Lưu Kết Quả
                    </button>
                    <button onClick={handlePrint} className="flex items-center justify-center gap-2 px-4 py-2 bg-white text-slate-700 border border-slate-300 font-semibold rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400 focus:ring-offset-white transition-colors duration-200 text-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                        In Biên Bản
                    </button>
                    <button onClick={() => setShowHistory(true)} className="flex items-center justify-center gap-2 px-4 py-2 bg-white text-slate-700 border border-slate-300 font-semibold rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400 focus:ring-offset-white transition-colors duration-200 text-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Xem Lịch Sử
                    </button>
                    <button onClick={handleExportExcel} className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 focus:ring-offset-white transition-colors duration-200 text-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                        Tải Excel
                    </button>
                    <button id="reset-button" onClick={handleReset} className="flex items-center justify-center gap-2 px-4 py-2 bg-[#3498db] text-white font-semibold rounded-lg hover:bg-[#2980b9] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#3498db] focus:ring-offset-white transition-colors duration-200 text-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.933 13.041a8 8 0 1 1 -9.925 -8.788c3.899 -1 7.935 1.007 9.425 4.747" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 4v5h-5" />
                        </svg>
                        Làm Mới
                    </button>
                  </div>
              </header>
              <div className="w-full grid grid-cols-1 lg:grid-cols-5 gap-6">
                  <div className="lg:col-span-2 flex flex-col gap-6">
                      <div className="bg-white p-5 rounded-xl shadow-md border border-slate-200/80">
                          <h2 className="text-xl font-semibold text-slate-800 mb-5">Bảng điều khiển</h2>
                          <div className="space-y-4">
                              <div>
                                  <label htmlFor="target-fund" className="text-sm font-semibold text-slate-600 mb-1 block">Tổng Dư Quỹ Cần Kiểm</label>
                                  <input id="target-fund" type="text" inputMode="numeric" value={formatNumber(targetFund)} onChange={handleTargetFundChange} placeholder="0" className="w-full bg-white border border-slate-300 rounded-lg py-2 px-3 text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-lg font-semibold"/>
                              </div>
                              <div>
                                   <label htmlFor="small-change" className="text-sm font-semibold text-slate-600 mb-1 block">Tiền Lẻ (không đếm)</label>
                                  <input id="small-change" type="text" inputMode="numeric" value={formatNumber(smallChange)} onChange={handleSmallChange} placeholder="0" className="w-full bg-white border border-slate-300 rounded-lg py-2 px-3 text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-lg font-semibold"/>
                              </div>
                          </div>
                      </div>
                      <div className="space-y-3">
                          <StatCard title="Quỹ Cần Cân Đối" value={formatCurrency(adjustedTargetFund)} />
                          <StatCard title="Tổng Tiền Mặt Đếm" value={formatCurrency(totalCash)} className="!bg-indigo-500/10 !border-indigo-200" />
                           <div className={`p-4 rounded-lg shadow-sm border transition-colors duration-300 ${getDifferenceColor()}`}>
                              <p className="text-sm font-semibold">{getDifferenceLabel()}</p>
                              <p className="text-3xl font-bold font-mono tracking-tight">{formatCurrency(difference)}</p>
                          </div>
                      </div>
                  </div>
                  <div className="lg:col-span-3 flex">
                      <div className="bg-white p-4 rounded-xl shadow-md border border-slate-200/80 w-full flex flex-col">
                          <h2 className="text-xl font-semibold text-slate-800 mb-4 flex-shrink-0">Chi Tiết Mệnh Giá</h2>
                          <div className="grid grid-cols-12 gap-4 px-2 pb-1.5 border-b border-slate-200 flex-shrink-0"><div className="col-span-5 text-left text-sm font-medium text-slate-500">Mệnh Giá</div><div className="col-span-3 text-center text-sm font-medium text-slate-500">Số Lượng</div><div className="col-span-4 text-right text-sm font-medium text-slate-500">Thành Tiền</div></div>
                          <div className="mt-1 space-y-0.5 flex-1 overflow-y-auto pr-2">
                              {denominations.map((denom, index) => (<div key={denom.value} className="grid grid-cols-12 items-center gap-4 px-2 py-1 rounded-md hover:bg-slate-50 transition-colors duration-150"><div className="col-span-5 font-semibold text-slate-700 text-base">{new Intl.NumberFormat('vi-VN').format(denom.value)}</div><div className="col-span-3"><input id={`denom-${denom.value}`} type="number" min="0" value={counts[denom.value] || ''} onChange={(e) => handleCountChange(denom.value, e.target.value)} onKeyDown={(e) => handleKeyDown(e, index)} placeholder="0" className="w-full border border-slate-300 rounded-md py-1.5 text-center text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-lg font-semibold" aria-label={`Số lượng tờ ${formatCurrency(denom.value)}`}/></div><div className="col-span-4 text-right font-mono text-slate-800 font-semibold text-base">{subtotals[denom.value] ? new Intl.NumberFormat('vi-VN').format(subtotals[denom.value]) : '0'}<span className="text-sm text-slate-500 font-sans ml-1">₫</span></div></div>))}
                          </div>
                      </div>
                  </div>
              </div>
              <footer className="text-center mt-6 text-slate-500 text-sm">
                  {lastResetTime ? (<p className="font-mono text-base mb-1">Thời gian kiểm quỹ cuối: {lastResetTime.toLocaleTimeString('vi-VN')} - {lastResetTime.toLocaleDateString('vi-VN')}</p>) : (<p className="font-mono text-base mb-1">Nhấn 'Làm Mới' để bắt đầu phiên kiểm quỹ</p>)}
                  <p>Thiết kế bởi 51118 - Đào Thế Anh</p>
              </footer>
            </div>
          </>
        );
      case 'kiem-ke':
        return (
          <div className="w-full max-w-7xl mx-auto">
            <header className="text-center mb-8">
                <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">KIỂM KÊ HÀNG HÓA</h1>
                <div className="mt-4 w-full max-w-lg mx-auto">
                    <div className="flex items-center gap-3">
                        <label htmlFor="excel-upload" className="flex-grow flex items-center justify-between w-full h-12 bg-white border border-slate-300 rounded-lg shadow-sm cursor-pointer hover:bg-slate-50 transition-colors duration-200 overflow-hidden">
                            <span className="pl-4 text-sm text-slate-500 truncate">
                                {fileName || 'Chọn file Excel để bắt đầu...'}
                            </span>
                            <span className="flex items-center justify-center h-full px-5 bg-indigo-600 text-white font-semibold rounded-r-md hover:bg-indigo-700 transition-colors duration-200 text-sm whitespace-nowrap">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor"><path d="M9.25 13.25a.75.75 0 001.5 0V4.856l2.188 2.428a.75.75 0 001.11-1.028l-3.5-3.888a.75.75 0 00-1.11 0l-3.5 3.888a.75.75 0 001.11 1.028L9.25 4.856v8.394z" /><path d="M3.75 16a.75.75 0 000 1.5h12.5a.75.75 0 000-1.5H3.75z" /></svg>
                                Nhập từ Excel
                            </span>
                        </label>
                        <input id="excel-upload" type="file" className="hidden" accept=".xlsx, .xls" onChange={handleFileImport} />
                        {inventoryItems.length > 0 && (
                            <button
                                onClick={handleInventoryReset}
                                className="flex-shrink-0 flex items-center justify-center gap-2 px-4 h-12 bg-[#3498db] text-white font-semibold rounded-lg hover:bg-[#2980b9] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#3498db] focus:ring-offset-white transition-colors duration-200 text-sm"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.933 13.041a8 8 0 1 1 -9.925 -8.788c3.899 -1 7.935 1.007 9.425 4.747" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 4v5h-5" />
                                </svg>
                                <span>Làm Mới</span>
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {inventoryItems.length > 0 && (
                <div className="my-6 p-4 bg-slate-100 rounded-lg border border-slate-200/80 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
                    <div className="flex items-center gap-2">
                        <label htmlFor="imei-filter" className="text-sm font-medium text-slate-600 shrink-0">Hiển thị:</label>
                        <div className="relative">
                            <select
                                id="imei-filter"
                                value={imeiFilter}
                                onChange={(e) => setImeiFilter(e.target.value as any)}
                                className="w-56 appearance-none block bg-white border border-slate-300 rounded-md py-2 pl-3 pr-10 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition hover:border-slate-400"
                            >
                                <option value="all">Tất cả sản phẩm</option>
                                <option value="with_imei">Sản phẩm có IMEI</option>
                                <option value="without_imei">Sản phẩm không có IMEI</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                                <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="category-filter" className="text-sm font-medium text-slate-600 shrink-0">Ngành hàng:</label>
                        <div className="relative">
                            <select
                                id="category-filter"
                                value={categoryFilter}
                                onChange={(e) => setCategoryFilter(e.target.value)}
                                className="w-56 appearance-none block bg-white border border-slate-300 rounded-md py-2 pl-3 pr-10 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition hover:border-slate-400"
                            >
                                <option value="all">Tất cả ngành hàng</option>
                                {availableCategories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                             <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                                <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="status-filter" className="text-sm font-medium text-slate-600 shrink-0">Trạng thái:</label>
                        <div className="relative">
                            <select
                                id="status-filter"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="w-56 appearance-none block bg-white border border-slate-300 rounded-md py-2 pl-3 pr-10 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition hover:border-slate-400"
                            >
                                <option value="all">Tất cả trạng thái</option>
                                {availableStatuses.map(status => (
                                    <option key={status} value={status}>{status}</option>
                                ))}
                            </select>
                             <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                                <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                            </div>
                        </div>
                    </div>
                    <button onClick={handleExportUncheckedItems} className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 focus:ring-offset-white transition-colors duration-200 text-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                           <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" clipRule="evenodd" />
                        </svg>
                        Xuất SP Chưa Kiểm
                    </button>
                </div>
            )}
            
            {filteredInventoryItems.length > 0 ? (
              <div className="mt-2 bg-white p-4 rounded-xl shadow-md border border-slate-200/80 w-full overflow-x-auto">
                <table className="w-full text-sm text-left text-slate-600">
                  <thead className="text-xs text-slate-700 uppercase bg-slate-50">
                    <tr>
                      <th scope="col" className="p-4 w-16 text-center">Đã kiểm</th>
                      <th scope="col" className="px-4 py-3 w-48 text-center">Mã QR</th>
                      <th scope="col" className="px-6 py-3">Tên sản phẩm</th>
                      <th scope="col" className="px-6 py-3 w-32 text-center">Số lượng</th>
                      <th scope="col" className="px-6 py-3 w-40 text-center">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInventoryItems.map((item) => {
                      const isDimmed = hoveredRowIndex !== null && hoveredRowIndex !== item.originalIndex;
                      const isCheckedAndDimmed = item.checked;

                      const rowClasses = `bg-white border-b hover:bg-slate-50 cursor-pointer transition-all duration-200`;
                      const qrClasses = `transition-opacity duration-200 ${isDimmed || isCheckedAndDimmed ? 'opacity-0' : ''}`;
                      const infoClasses = `transition-opacity duration-200 ${isDimmed || isCheckedAndDimmed ? 'opacity-60' : ''}`;
                      const checkedClasses = item.checked ? 'line-through' : '';

                      return (
                      <tr key={item.originalIndex} 
                          id={`inventory-item-${item.originalIndex}`}
                          onClick={() => handleCheckItem(item.originalIndex)}
                          onMouseEnter={() => setHoveredRowIndex(item.originalIndex)}
                          onMouseLeave={() => setHoveredRowIndex(null)}
                          className={`${rowClasses} ${checkedClasses}`}>
                        <td className={`p-4 text-center ${infoClasses}`}>
                          <input type="checkbox" checked={item.checked} readOnly className="w-5 h-5 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500 focus:ring-2 pointer-events-none"/>
                        </td>
                        <td className={`px-4 py-2 text-center ${qrClasses}`}>
                            <div className="flex flex-col items-center justify-center">
                                <div className="w-16 h-16 mb-2">
                                    <QRCodeComponent text={item.qrCode} size={64} />
                                </div>
                                <span className="text-xs font-sans text-slate-500 break-all">{item.qrCode}</span>
                            </div>
                        </td>
                        <td className={`px-6 py-4 font-medium text-slate-900 text-lg ${infoClasses}`}>
                           <div className="flex items-center gap-3">
                                <CategoryIcon category={item.category} className="text-xl text-slate-500 flex-shrink-0" />
                                <span>{item.productName}</span>
                            </div>
                        </td>
                        <td className={`px-6 py-4 text-center font-semibold text-lg ${infoClasses}`}>{item.quantity}</td>
                        <td className={`px-6 py-4 text-center ${infoClasses}`}>{item.status}</td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            ) : (
                fileName 
                ? (
                    <div className="text-center py-10 px-4 mt-6 bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
                        <p className="text-slate-500">Không tìm thấy sản phẩm nào phù hợp với bộ lọc.</p>
                    </div>
                ) 
                : (
                    <div className="text-left py-10 px-8 mt-6 bg-white rounded-xl shadow-md border border-slate-200/80 max-w-3xl mx-auto">
                        <div className="flex items-center gap-4 mb-5">
                            <div className="flex-shrink-0 bg-indigo-100 rounded-full p-3">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h2 className="text-xl font-bold text-slate-800">Hướng Dẫn Chức Năng Kiểm Kê</h2>
                        </div>
                        <div className="space-y-4 text-slate-600">
                           <p>Đối soát hàng hóa nhanh chóng từ file Excel. Tải file lên, click vào từng dòng để đánh dấu đã kiểm, và xuất ra file riêng các sản phẩm chưa được kiểm.</p>
                             <h3 className="font-semibold text-slate-700 mb-2 text-base">Yêu cầu file Excel:</h3>
                              <ul className="list-disc list-inside space-y-1.5 pl-4 text-sm">
                                  <li><strong>Bắt buộc:</strong> Cột <code>Tên sản phẩm</code>, <code>Số lượng</code>.</li>
                                  <li><strong>Khuyến nghị:</strong> Cột <code>Giá bán</code>, <code>IMEI_1</code> (để tạo QR), <code>Mã sản phẩm</code>, <code>Ngành hàng</code>, <code>trạng thái sản phẩm</code>.</li>
                              </ul>
                        </div>
                    </div>
                )
            )}
          </div>
        );
      case 'kiem-tra-ton-kho':
        return (
          <div className="w-full max-w-4xl mx-auto">
              <header className="text-center mb-8">
                <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">KIỂM TRA TỒN KHO</h1>
                 <div className="mt-4 w-full max-w-lg mx-auto">
                    <label htmlFor="excel-upload-search" className="flex items-center justify-between w-full h-12 bg-white border border-slate-300 rounded-lg shadow-sm cursor-pointer hover:bg-slate-50 transition-colors duration-200 overflow-hidden">
                        <span className="pl-4 text-sm text-slate-500 truncate">
                            {fileName || 'Chọn file Excel để bắt đầu...'}
                        </span>
                        <span className="flex items-center justify-center h-full px-5 bg-indigo-600 text-white font-semibold rounded-r-md hover:bg-indigo-700 transition-colors duration-200 text-sm whitespace-nowrap">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor"><path d="M9.25 13.25a.75.75 0 001.5 0V4.856l2.188 2.428a.75.75 0 001.11-1.028l-3.5-3.888a.75.75 0 00-1.11 0l-3.5 3.888a.75.75 0 001.11 1.028L9.25 4.856v8.394z" /><path d="M3.75 16a.75.75 0 000 1.5h12.5a.75.75 0 000-1.5H3.75z" /></svg>
                            Nhập từ Excel
                        </span>
                    </label>
                    <input id="excel-upload-search" type="file" className="hidden" accept=".xlsx, .xls" onChange={handleFileImport} />
                </div>
            </header>

            {inventoryItems.length > 0 ? (
                <div className="w-full">
                    <form onSubmit={handleSearchSubmit} className="relative mb-6">
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onFocus={() => {
                                if (searchQuery.trim().length > 1 && suggestions.length > 0) {
                                     setIsSuggestionsVisible(true);
                                }
                            }}
                            onBlur={() => setTimeout(() => setIsSuggestionsVisible(false), 200)}
                            placeholder="Quét mã hoặc tìm theo tên sản phẩm..."
                            className="w-full pl-5 pr-12 py-3 text-lg bg-white border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            autoFocus
                            autoComplete="off"
                        />
                         <div className="absolute inset-y-0 right-0 flex items-center pr-5 pointer-events-none">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        </div>
                        {isSuggestionsVisible && suggestions.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1.5 w-full bg-white rounded-lg shadow-xl border border-slate-200 z-10 max-h-72 overflow-y-auto">
                                <ul className="py-1">
                                    {suggestions.map((suggestion) => (
                                        <li
                                            key={suggestion.originalIndex}
                                            className="px-4 py-2.5 text-slate-700 hover:bg-indigo-50 cursor-pointer"
                                            onMouseDown={() => handleSuggestionClick(suggestion)}
                                        >
                                            <p className="font-semibold text-base text-slate-800">{suggestion.productName}</p>
                                            <p className="text-sm text-slate-500">
                                                Mã: <span className="font-mono">{suggestion.productCodeForSearch || suggestion.qrCode}</span> - SL: <span className="font-mono">{suggestion.quantity}</span>
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </form>
                    
                    <div className="space-y-4">
                        {searchHistory.map((item, index) => (
                          <div key={index} className={`p-5 rounded-lg border-l-8 shadow-md transition-all duration-300 bg-white ${item.result ? 'border-green-500' : 'border-red-500'} ${index === 0 ? 'transform scale-105 shadow-lg' : 'opacity-80'}`}>
                              <p className="text-xs text-slate-500 mb-3">Đã tìm kiếm: <span className="font-mono font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{item.query}</span></p>
                              {item.result ? (
                                <div className="space-y-4">
                                    <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3">
                                        <CategoryIcon category={item.result.category} className="text-2xl text-slate-700" />
                                        <span>{item.result.productName}</span>
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-3 text-sm">
                                        <div className="flex items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                                            <span className="font-medium">Số lượng:</span>
                                            <span className="font-bold font-mono text-indigo-600 text-base">{item.result.quantity}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg>
                                            <span className="font-medium">Trạng thái:</span>
                                            <span className="font-semibold">{item.result.status}</span>
                                        </div>
                                         <div className="flex items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full">
                                            <CategoryIcon category={item.result.category} />
                                            <span className="font-medium">Ngành hàng:</span>
                                            <span className="font-semibold">{item.result.category}</span>
                                        </div>
                                        {item.result.productCodeForSearch && (
                                            <div className="flex items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M16 4v12l-4-2-4 2V4M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                <span className="font-medium">Mã SP:</span>
                                                <span className="font-semibold font-mono">{item.result.productCodeForSearch}</span>
                                            </div>
                                        )}
                                        {item.result.hasImei && (
                                            <div className="flex items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m-4-14v12m-4-10v8m12-9v10m-4-8v6" /></svg>
                                                <span className="font-medium">IMEI:</span>
                                                <span className="font-semibold font-mono">{item.result.qrCode}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-3">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                  <p className="text-lg font-semibold text-red-700">Không tìm thấy sản phẩm.</p>
                                </div>
                              )}
                          </div>
                        ))}
                    </div>

                </div>
            ) : (
                <div className="text-left py-10 px-8 mt-6 bg-white rounded-xl shadow-md border border-slate-200/80 max-w-3xl mx-auto">
                    <div className="flex items-center gap-4 mb-5">
                        <div className="flex-shrink-0 bg-indigo-100 rounded-full p-3">
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <h2 className="text-xl font-bold text-slate-800">Hướng Dẫn Chức Năng Tra Tồn Kho</h2>
                    </div>
                    <div className="space-y-4 text-slate-600">
                        <p>Tra cứu thông tin sản phẩm tức thì từ file tồn kho. Tải file lên, sau đó quét mã vạch hoặc nhập mã/tên sản phẩm vào ô tìm kiếm để xem chi tiết.</p>
                    </div>
                </div>
            )}
          </div>
        );
       case 'kiem-hang-chuyen-kho':
            return (
                <div className="w-full max-w-7xl mx-auto">
                    <header className="text-center mb-8">
                        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">KIỂM HÀNG CHUYỂN KHO</h1>
                        <div className="mt-6 w-full max-w-lg mx-auto">
                            <div className="flex items-center gap-3">
                                <label htmlFor="excel-check-upload" className="flex-grow flex items-center justify-between w-full h-12 bg-white border border-slate-300 rounded-lg shadow-sm cursor-pointer hover:bg-slate-50 transition-colors duration-200 overflow-hidden">
                                    <span className="pl-4 text-sm text-slate-500 truncate">{excelCheckFileName || 'Chọn file Excel để bắt đầu...'}</span>
                                    <span className="flex items-center justify-center h-full px-5 bg-indigo-600 text-white font-semibold rounded-r-md hover:bg-indigo-700 transition-colors duration-200 text-sm whitespace-nowrap">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor"><path d="M9.25 13.25a.75.75 0 001.5 0V4.856l2.188 2.428a.75.75 0 001.11-1.028l-3.5-3.888a.75.75 0 00-1.11 0l-3.5 3.888a.75.75 0 001.11 1.028L9.25 4.856v8.394z" /><path d="M3.75 16a.75.75 0 000 1.5h12.5a.75.75 0 000-1.5H3.75z" /></svg>
                                        Nhập từ Excel
                                    </span>
                                </label>
                                <input id="excel-check-upload" type="file" className="hidden" accept=".xlsx, .xls" onChange={handleFileImportForExcelCheck} />
                                {excelCheckItems.length > 0 && (
                                    <button onClick={handleExcelCheckReset} className="flex-shrink-0 flex items-center justify-center gap-2 px-4 h-12 bg-[#3498db] text-white font-semibold rounded-lg hover:bg-[#2980b9] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#3498db] focus:ring-offset-white transition-colors duration-200 text-sm">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.933 13.041a8 8 0 1 1 -9.925 -8.788c3.899 -1 7.935 1.007 9.425 4.747" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 4v5h-5" />
                                        </svg>
                                        <span>Làm Mới</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </header>

                    {excelCheckItems.length > 0 ? (
                        <>
                            <div className="mb-6 p-6 bg-slate-100 rounded-xl border border-slate-200/80 max-w-3xl mx-auto">
                                <form onSubmit={handleScanSubmit} className="relative">
                                    <label htmlFor="scan-input" className="block text-sm font-medium text-slate-700 mb-2">Khu vực quét mã (Mã SP hoặc IMEI)</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m-4-14v12m-4-10v8m12-9v10m-4-8v6" /></svg>
                                        </div>
                                        <input
                                            id="scan-input"
                                            ref={scanInputRef}
                                            type="text"
                                            value={scanQuery}
                                            onChange={(e) => {
                                                setScanQuery(e.target.value);
                                                if (scanStatus.type !== 'idle') setScanStatus({ type: 'idle', message: 'Sẵn sàng quét...' });
                                            }}
                                            placeholder="Đặt con trỏ vào đây và quét..."
                                            className="w-full pl-14 pr-4 py-3 text-lg bg-white border-2 border-slate-300 rounded-lg shadow-sm focus:outline-none focus:border-indigo-500 transition-colors"
                                            autoComplete="off"
                                        />
                                    </div>
                                    <p className={`mt-2 text-sm h-5 transition-colors ${scanStatus.type === 'success' ? 'text-green-600' : scanStatus.type === 'error' ? 'text-red-600' : 'text-slate-500'}`}>
                                        {scanStatus.message}
                                    </p>
                                </form>
                            </div>

                            <div className="my-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                                <StatCard title="Tổng SL (File)" value={formatNumber(excelCheckStats.totalFileQuantity) || '0'} />
                                <StatCard title="Tổng SL (Thực Tế)" value={formatNumber(excelCheckStats.totalActualQuantity) || '0'} className="!bg-indigo-500/10 !border-indigo-200" />
                                <StatCard title="Số Lượng Khớp" value={excelCheckStats.matchedCount} className="!bg-green-500/10 !border-green-200" />
                                <StatCard title="Số Lượng Lệch" value={excelCheckStats.mismatchedCount} className="!bg-red-500/10 !border-red-200" />
                            </div>

                            <div className="flex justify-center mb-6">
                                <button onClick={handleExportExcelCheckResult} className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 focus:ring-offset-white transition-colors duration-200 text-sm">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" clipRule="evenodd" /></svg>
                                    Xuất Kết Quả
                                </button>
                            </div>

                            <div className="bg-white p-4 rounded-xl shadow-md border border-slate-200/80 w-full overflow-x-auto">
                                <table className="w-full text-sm text-left text-slate-600">
                                    <thead className="text-xs text-slate-700 uppercase bg-slate-50">
                                        <tr>
                                            <th scope="col" className="px-6 py-3 min-w-[300px]">Tên sản phẩm</th>
                                            <th scope="col" className="px-6 py-3 w-40 text-center">SL (File)</th>
                                            <th scope="col" className="px-6 py-3 w-48 text-center">SL (Thực Tế)</th>
                                            <th scope="col" className="px-6 py-3 w-40 text-center">Chênh lệch</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {excelCheckItems.map((item, index) => {
                                            const difference = item.actualQuantity !== null ? item.actualQuantity - item.fileQuantity : null;
                                            let rowColor = 'bg-white';
                                            let diffColor = 'text-slate-700';
                                            if (difference !== null) {
                                                if (difference === 0) { rowColor = 'bg-green-50'; diffColor = 'text-green-600'; }
                                                else if (difference > 0) { rowColor = 'bg-amber-50'; diffColor = 'text-amber-600'; }
                                                else { rowColor = 'bg-red-50'; diffColor = 'text-red-600'; }
                                            }
                                            const isLastScanned = lastScannedIndex === index;

                                            return (
                                                <tr key={index} id={`excel-check-item-tr-${index}`} className={`${rowColor} border-b transition-all duration-500 ${isLastScanned ? 'ring-2 ring-indigo-500 ring-offset-2' : ''}`}>
                                                    <td className="px-6 py-4 font-medium text-slate-900">
                                                        <div className="flex items-center gap-3">
                                                          <CategoryIcon category={item.category} className="text-xl text-slate-500 flex-shrink-0" />
                                                          <div>
                                                              {item.productName}
                                                              <br/>
                                                              <span className="text-xs font-mono text-slate-500">{item.productCode}</span>
                                                          </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-center font-bold text-lg">{item.fileQuantity}</td>
                                                    <td className="px-6 py-4">
                                                        <input 
                                                            id={`excel-check-item-${index}`}
                                                            type="number" 
                                                            min="0"
                                                            value={item.actualQuantity ?? ''} 
                                                            onChange={(e) => handleActualQuantityChange(index, e.target.value)} 
                                                            onKeyDown={(e) => handleExcelCheckKeyDown(e, index)}
                                                            placeholder="Nhập..." 
                                                            className="w-full border border-slate-300 rounded-md py-1.5 text-center text-slate-900 text-lg font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                                        />
                                                    </td>
                                                    <td className={`px-6 py-4 text-center font-bold text-lg ${diffColor}`}>
                                                        {difference !== null ? (difference > 0 ? `+${difference}` : difference) : '-'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            
                            {mismatchedItems.length > 0 && (
                                <div className="mt-8">
                                    <h2 className="text-xl font-bold text-slate-800 mb-4 text-center">Danh Sách Sản Phẩm Chênh Lệch</h2>
                                    <div className="bg-white p-4 rounded-xl shadow-md border border-slate-200/80 w-full max-w-4xl mx-auto">
                                        <ul className="divide-y divide-slate-200">
                                            {mismatchedItems.map((item, index) => {
                                                 const difference = item.actualQuantity! - item.fileQuantity;
                                                 const isMissing = difference < 0;
                                                 return (
                                                    <li key={`mismatch-${index}`} className={`py-3 px-2 flex justify-between items-center ${isMissing ? 'bg-red-50/50' : 'bg-amber-50/50'}`}>
                                                        <div>
                                                            <p className="font-semibold text-slate-800">{item.productName}</p>
                                                            <p className="text-sm font-mono text-slate-500">{item.productCode}</p>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className={`font-bold text-lg ${isMissing ? 'text-red-600' : 'text-amber-600'}`}>
                                                                {isMissing ? `Thiếu ${Math.abs(difference)}` : `Thừa ${difference}`}
                                                            </p>
                                                            <p className="text-sm text-slate-500 font-mono">
                                                                File: {item.fileQuantity} | TT: {item.actualQuantity}
                                                            </p>
                                                        </div>
                                                    </li>
                                                 )
                                            })}
                                        </ul>
                                    </div>
                                </div>
                            )}

                        </>
                    ) : (
                        <div className="text-left py-10 px-8 mt-6 bg-white rounded-xl shadow-md border border-slate-200/80 max-w-3xl mx-auto">
                            <div className="flex items-center gap-4 mb-5">
                                <div className="flex-shrink-0 bg-indigo-100 rounded-full p-3">
                                   <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                </div>
                                <h2 className="text-xl font-bold text-slate-800">Hướng Dẫn Chức Năng Kiểm Hàng</h2>
                            </div>
                             <div className="space-y-4 text-slate-600">
                                <p>Đối soát số lượng hàng hóa thực tế so với file Excel. Tải file lên, dùng máy quét để cập nhật số lượng, và xuất báo cáo chênh lệch.</p>
                                <h3 className="font-semibold text-slate-700 mb-2 text-base">Yêu cầu file Excel:</h3>
                                <ul className="list-disc list-inside space-y-1.5 pl-4 text-sm">
                                  <li><strong>Bắt buộc:</strong> Cột <code>Tên sản phẩm</code>, <code>Số lượng</code>.</li>
                                  <li><strong>Khuyến nghị:</strong> Cột <code>Mã sản phẩm</code> và/hoặc <code>IMEI_1</code> để quét mã vạch.</li>
                                </ul>
                            </div>
                        </div>
                    )}
                </div>
            );
      case 'thay-posm':
        return (
          <div className="w-full max-w-[900px] mx-auto">
            <header className="text-center mb-8">
                <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">THAY ĐỔI BẢNG GIÁ (POSM)</h1>
                <div className="mt-6 w-full max-w-3xl mx-auto">
                    <div className="flex items-center gap-3">
                        <label htmlFor="posm-upload" className="flex-grow flex items-center justify-between w-full h-12 bg-white border border-slate-300 rounded-lg shadow-sm cursor-pointer hover:bg-slate-50 transition-colors duration-200 overflow-hidden">
                            <span className="pl-4 text-sm text-slate-500 truncate">{posmFileName || 'Chọn file Excel để bắt đầu...'}</span>
                            <span className="flex items-center justify-center h-full px-5 bg-indigo-600 text-white font-semibold rounded-r-md hover:bg-indigo-700 transition-colors duration-200 text-sm whitespace-nowrap">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor"><path d="M9.25 13.25a.75.75 0 001.5 0V4.856l2.188 2.428a.75.75 0 001.11-1.028l-3.5-3.888a.75.75 0 00-1.11 0l-3.5 3.888a.75.75 0 001.11 1.028L9.25 4.856v8.394z" /><path d="M3.75 16a.75.75 0 000 1.5h12.5a.75.75 0 000-1.5H3.75z" /></svg>
                                Nhập từ Excel
                            </span>
                        </label>
                        <input id="posm-upload" type="file" className="hidden" accept=".xlsx, .xls" onChange={handlePosmFileImport} />
                        {posmItems.length > 0 && (
                            <button onClick={handlePosmReset} className="flex-shrink-0 flex items-center justify-center gap-2 px-4 h-12 bg-[#3498db] text-white font-semibold rounded-lg hover:bg-[#2980b9] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#3498db] focus:ring-offset-white transition-colors duration-200 text-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.933 13.041a8 8 0 1 1 -9.925 -8.788c3.899 -1 7.935 1.007 9.425 4.747" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 4v5h-5" />
                                </svg>
                                <span>Làm Mới</span>
                            </button>
                        )}
                    </div>
                </div>
                 {posmItems.length > 0 && (
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                         <span className="text-sm font-semibold text-slate-700 mr-2">Tuỳ chọn in ({selectedPosmItems.length} đã chọn):</span>
                         <button onClick={() => handlePrintPosm('a5-2')} disabled={selectedPosmItems.length === 0} className="px-4 py-2 text-sm bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed">In khổ A5 (2SP)</button>
                         <button onClick={() => handlePrintPosm('a6-2')} disabled={selectedPosmItems.length === 0} className="px-4 py-2 text-sm bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed">In khổ A6 (2SP)</button>
                    </div>
                 )}
            </header>

            {posmItems.length > 0 ? (
                <div className="bg-white p-4 rounded-xl shadow-md border border-slate-200/80 w-full overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-600">
                        <thead className="text-xs text-slate-700 uppercase bg-slate-50">
                            <tr>
                                <th scope="col" className="p-4 w-16 text-center">
                                     <input
                                        type="checkbox"
                                        className="w-5 h-5 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500 focus:ring-2"
                                        checked={posmItems.length > 0 && selectedPosmItems.length === posmItems.length}
                                        onChange={handlePosmSelectAll}
                                        aria-label="Chọn tất cả"
                                    />
                                </th>
                                <th scope="col" className="px-6 py-3 min-w-[250px]">Tên sản phẩm</th>
                                <th scope="col" className="px-6 py-3 w-48 text-right">Giá Cũ</th>
                                <th scope="col" className="px-6 py-3 w-48 text-right">Giá Mới</th>
                            </tr>
                        </thead>
                        <tbody>
                            {posmItems.map((item, index) => (
                                <tr key={`${item.productCode}-${index}`} className="bg-white border-b hover:bg-slate-50">
                                    <td className="p-4 text-center">
                                         <input
                                            type="checkbox"
                                            className="w-5 h-5 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500 focus:ring-2"
                                            checked={selectedPosmItems.includes(item.productCode)}
                                            onChange={() => handlePosmSelect(item.productCode)}
                                        />
                                    </td>
                                    <td className="px-6 py-4 font-medium text-slate-900">
                                        {item.productName}
                                        <br/>
                                        <span className="text-xs font-mono text-slate-500">{item.productCode.split('-')[0]}</span>
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-500">{formatCurrency(item.oldPrice)}</td>
                                    <td className="px-6 py-4 text-right font-mono font-bold text-indigo-600 text-base">{formatCurrency(item.newPrice)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="text-left py-10 px-8 mt-6 bg-white rounded-xl shadow-md border border-slate-200/80 max-w-3xl mx-auto">
                    <div className="flex items-center gap-4 mb-5">
                        <div className="flex-shrink-0 bg-indigo-100 rounded-full p-3">
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <h2 className="text-xl font-bold text-slate-800">Hướng Dẫn In Bảng Giá (POSM)</h2>
                    </div>
                     <div className="space-y-4 text-slate-600">
                        <p>Tạo và in bảng giá (POSM) tự động từ file Excel. Ứng dụng sẽ tự nhận diện các cột Tên sản phẩm, Giá cũ, Giá mới, và Khuyến mãi để tạo bảng giá chuyên nghiệp.</p>
                         <h3 className="font-semibold text-slate-700 mb-2 text-base">Cơ chế nhận diện cột:</h3>
                            <ul className="list-disc list-inside space-y-1.5 pl-4 text-sm">
                                <li><strong>Ưu tiên 1:</strong> Tìm chính xác các cột có tiêu đề: <code>Tên sản phẩm</code>, <code>Mã sản phẩm</code>, <code>Giá gốc</code>/<code>Giá cũ</code>, <code>Giá mới</code>/<code>Giá sau giảm</code>, <code>Khuyến mãi</code>.</li>
                                <li><strong>Ưu tiên 2 (Nếu không có tiêu đề):</strong> Mặc định lấy dữ liệu từ các cột: <strong>Z</strong> (Tên SP), <strong>AA</strong> (Mã SP), <strong>P</strong> (Giá cũ), <strong>Q</strong> (Giá mới), <strong>AD</strong> (Khuyến mãi).</li>
                            </ul>
                    </div>
                </div>
            )}
          </div>
        );
      case 'thong-tin':
        return (
            <div className="w-full max-w-6xl mx-auto">
                <div className="text-center mb-12">
                    <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900">Thông Tin Ứng Dụng</h1>
                    <p className="mt-4 text-lg text-slate-600 max-w-3xl mx-auto">
                        Công cụ hỗ trợ toàn diện giúp tối ưu hóa và đơn giản hóa các nghiệp vụ hàng ngày.
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                    <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-lg border border-slate-200/80">
                        <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            Phiên bản hiện tại
                        </h2>
                        <div>
                            <div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                    <span className="bg-indigo-600 text-white font-bold text-sm px-3 py-1 rounded-full">v1.6.0</span>
                                    <h3 className="text-lg font-semibold text-slate-800">Cải Thiện & Tính Năng Mới</h3>
                                </div>
                                <ul className="mt-4 space-y-2.5 border-l-2 border-slate-200 pl-6 text-slate-600">
                                    <li className="relative pl-2">
                                        <span className="absolute -left-[30px] top-1.5 h-2 w-2 rounded-full bg-green-300"></span>
                                        <span className="font-semibold text-xs px-2 py-0.5 rounded-full mr-2 bg-green-100 text-green-800">[TÍNH NĂNG MỚI]</span>
                                        Tạo Mã Vạch: Bổ sung tính năng tạo Barcode (Mã vạch) cho phép in ấn trực tiếp, bên cạnh Mã QR hiện có.
                                    </li>
                                    <li className="relative pl-2">
                                        <span className="absolute -left-[30px] top-1.5 h-2 w-2 rounded-full bg-purple-300"></span>
                                        <span className="font-semibold text-xs px-2 py-0.5 rounded-full mr-2 bg-purple-100 text-purple-800">[THUẬT TOÁN]</span>
                                        Nâng cấp Thay POSM: Cải thiện thuật toán nhận diện cột Excel thông minh hơn, xử lý tốt các file phức tạp (như điện lạnh) để nhận diện chính xác Giá gốc/Giá mới.
                                    </li>
                                    <li className="relative pl-2">
                                        <span className="absolute -left-[30px] top-1.5 h-2 w-2 rounded-full bg-green-300"></span>
                                        <span className="font-semibold text-xs px-2 py-0.5 rounded-full mr-2 bg-green-100 text-green-800">[TÍNH NĂNG MỚI]</span>
                                        Hệ thống báo lỗi nâng cao: Thay thế nút báo lỗi cũ bằng biểu mẫu chi tiết, cho phép đính kèm ảnh chụp màn hình để phản hồi chính xác hơn.
                                    </li>
                                </ul>
                            </div>
                        </div>
                        <div className="mt-8 pt-6 border-t border-slate-200">
                            <h3 className="text-xl font-bold text-slate-800 mb-3 flex items-center gap-3">
                                <span className="material-symbols-outlined text-red-500">bug_report</span>
                                Phản hồi & Báo lỗi
                            </h3>
                            <p className="text-sm text-slate-600 mb-4">
                                Ứng dụng đang trong quá trình phát triển, nếu có lỗi gì vui lòng phản hồi về gmail của tôi.
                            </p>
                            <button
                                onClick={() => handleOpenBugReport('thong-tin')}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 font-semibold rounded-lg border border-red-200 hover:bg-red-200/60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors duration-200 text-sm"
                            >
                                <span className="material-symbols-outlined text-base">email</span>
                                <span>Báo lỗi qua Gmail</span>
                            </button>
                        </div>
                    </div>

                    <div className="space-y-6">
                        {isFree && (
                             <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-slate-200 relative overflow-hidden">
                                <div className="flex items-center gap-4 mb-4 relative z-10">
                                    <div className="flex-shrink-0 bg-slate-100 text-slate-500 rounded-full p-2.5 inline-flex">
                                        <span className="material-symbols-outlined">workspace_premium</span>
                                    </div>
                                    <h2 className="text-xl font-bold text-slate-700">Nâng Cấp Tài Khoản VIP</h2>
                                </div>
                                <p className="text-slate-500 mb-5 text-sm relative z-10">Tính năng nâng cấp tạm thời bị khóa để bảo trì hệ thống. Vui lòng quay lại sau.</p>
                                <button disabled className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-300 text-white font-bold rounded-lg border border-slate-300 cursor-not-allowed relative z-10">
                                    Tạm khóa bảo trì
                                </button>
                            </div>
                        )}
                        <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200/80">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="flex-shrink-0 bg-indigo-100 text-indigo-600 rounded-full p-2.5 inline-flex">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                    </svg>
                                </div>
                                <h2 className="text-xl font-bold text-slate-800">Tính năng nổi bật</h2>
                            </div>
                            <ul className="space-y-2 text-sm text-slate-600 list-disc list-inside">
                                <li>Kiểm quỹ thu ngân nhanh chóng và chính xác.</li>
                                <li>Kiểm kê hàng hóa từ file Excel, có tạo mã QR.</li>
                                <li>Tra cứu tồn kho tức thì bằng máy quét hoặc tên.</li>
                                <li>Đối soát hàng chuyển kho hiệu quả.</li>
                                <li>Tự động tạo và in bảng giá (POSM) chuyên nghiệp.</li>
                            </ul>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200/80">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="flex-shrink-0 bg-indigo-100 text-indigo-600 rounded-full p-2.5 inline-flex">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0012 11z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <h2 className="text-xl font-bold text-slate-800">Người phát triển</h2>
                            </div>
                             <p className="text-slate-600 text-sm">
                                Ứng dụng được thiết kế và phát triển bởi <strong className="text-slate-700">51118 - Đào Thế Anh</strong>.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
          );
      case 'ma-qr':
        return (
            <div className="w-full max-w-2xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">TẠO MÃ QR / BARCODE</h1>
                </header>
                <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200/80">
                    
                    <div className="flex justify-center mb-6">
                        <div className="inline-flex rounded-md shadow-sm" role="group">
                            <button
                                type="button"
                                onClick={() => setCodeType('qr')}
                                className={`px-4 py-2 text-sm font-medium border rounded-l-lg focus:z-10 focus:ring-2 focus:ring-indigo-500 focus:text-indigo-700 ${codeType === 'qr' ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                            >
                                Mã QR (QR Code)
                            </button>
                            <button
                                type="button"
                                onClick={() => setCodeType('barcode')}
                                className={`px-4 py-2 text-sm font-medium border rounded-r-lg focus:z-10 focus:ring-2 focus:ring-indigo-500 focus:text-indigo-700 ${codeType === 'barcode' ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                            >
                                Mã Vạch (Barcode)
                            </button>
                        </div>
                    </div>

                    <div>
                        <label htmlFor="qr-input" className="block text-sm font-semibold text-slate-700 mb-2">
                            Nội dung mã {codeType === 'qr' ? 'QR' : 'Vạch'}
                        </label>
                        <input
                            id="qr-input"
                            type="text"
                            value={qrGeneratorText}
                            onChange={(e) => setQrGeneratorText(e.target.value)}
                            placeholder={codeType === 'qr' ? "Nhập văn bản hoặc liên kết..." : "Nhập mã số hoặc ký tự..."}
                            className="w-full p-3 bg-white border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                        />
                    </div>
                    
                    {qrGeneratorText && (
                        <div className="mt-6 pt-6 border-t border-slate-200 flex flex-col items-center">
                            <h3 className="text-lg font-semibold text-slate-800 mb-4">Kết quả của bạn:</h3>
                            <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm inline-block mb-4">
                                {codeType === 'qr' ? (
                                    <QRCodeComponent text={qrGeneratorText} size={256} />
                                ) : (
                                    <BarcodeComponent text={qrGeneratorText} />
                                )}
                            </div>
                            {codeType === 'barcode' && (
                                <button 
                                    onClick={handlePrintBarcode}
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white font-semibold rounded-lg hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-800 transition-colors"
                                >
                                    <span className="material-symbols-outlined">print</span>
                                    In Mã Vạch
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
      case 'tinh-thuong':
          return (
              <div className="w-full max-w-4xl mx-auto">
                  <header className="text-center mb-8 flex flex-col items-center">
                      <div className="flex items-center justify-center">
                        <span className="material-symbols-outlined text-4xl text-indigo-600 mr-2">paid</span>
                        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">TÍNH THƯỞNG</h1>
                      </div>
                  </header>

                  <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200/80">
                      <div className="mb-6">
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Tải lên hình ảnh phiếu lương/thưởng</label>
                          <div className="flex items-center justify-center w-full">
                              <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-48 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                      <span className="material-symbols-outlined text-6xl text-slate-300 mb-3">cloud_upload</span>
                                      <p className="mb-2 text-sm text-slate-500"><span className="font-semibold">Nhấn để tải lên</span> hoặc kéo thả</p>
                                  </div>
                                  <input id="dropzone-file" type="file" className="hidden" multiple accept="image/*" onChange={handleBonusImageUpload} />
                              </label>
                          </div>
                      </div>

                      {bonusImages.length > 0 && (
                          <div className="mb-6">
                              <p className="text-sm font-medium text-slate-700 mb-2">Đã chọn {bonusImages.length} hình ảnh:</p>
                              <div className="flex flex-wrap gap-2">
                                  {bonusImages.map((file, idx) => (
                                      <div key={idx} className="relative group">
                                          <div className="w-20 h-20 rounded-md overflow-hidden border border-slate-200">
                                              <img src={URL.createObjectURL(file)} alt="preview" className="w-full h-full object-cover" />
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      )}

                      <div className="flex justify-center">
                          <button
                              onClick={handleAnalyzeBonus}
                              disabled={isAnalyzingBonus || bonusImages.length === 0}
                              className={`flex items-center gap-2 px-6 py-3 font-semibold rounded-lg shadow-md text-white transition-all ${
                                  isAnalyzingBonus || bonusImages.length === 0
                                      ? 'bg-slate-400 cursor-not-allowed'
                                      : 'bg-orange-600 hover:bg-orange-700 hover:shadow-lg'
                              }`}
                          >
                              {isAnalyzingBonus && bonusAnalysisProgress ? (
                                  <>
                                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                      </svg>
                                      <span>{`${bonusAnalysisProgress.status} (${bonusAnalysisProgress.progress}%)`}</span>
                                  </>
                              ) : isAnalyzingBonus ? (
                                  <>
                                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                      </svg>
                                      Đang khởi tạo...
                                  </>
                              ) : (
                                  <>
                                      <span className="material-symbols-outlined">analytics</span>
                                      Phân tích & Tính thưởng
                                  </>
                              )}
                          </button>
                      </div>
                  </div>

                  {bonusItems.length > 0 && (
                      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
                          {/* Kết quả phân tích */}
                          <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200/80">
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-blue-600">receipt_long</span>
                                    Chi Tiết Thu Nhập
                                </h3>
                                <div ref={bonusFilterDropdownRef} className="relative">
                                  <button 
                                      onClick={() => setIsBonusFilterDropdownOpen(!isBonusFilterDropdownOpen)}
                                      className={`p-2 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${isBonusFilterDropdownOpen ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                      title="Lọc các khoản thu nhập"
                                  >
                                      <span className="material-symbols-outlined">filter_alt</span>
                                  </button>
                                  {isBonusFilterDropdownOpen && (
                                    <div className="absolute right-0 mt-2 w-72 bg-white rounded-md shadow-lg py-2 ring-1 ring-black ring-opacity-5 z-20">
                                      <div className="px-3 py-1 text-xs font-semibold text-slate-500 uppercase">Chọn khoản thu nhập</div>
                                      <div className="max-h-60 overflow-y-auto mt-1">
                                        {bonusItems.map((item, index) => (
                                          <label key={index} className="flex items-center gap-3 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                                            <input 
                                                type="checkbox" 
                                                checked={!excludedBonusIndices.includes(index)}
                                                onChange={() => toggleBonusItem(index)}
                                                className="w-4 h-4 text-blue-600 bg-white border-gray-300 rounded focus:ring-blue-500"
                                            />
                                            <span className="flex-grow">{item.description}</span>
                                            <span className="font-mono text-xs">{formatCurrency(item.amount)}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                                  {activeBonusItems.length > 0 ? (activeBonusItems.map((item, index) => {
                                      const originalIndex = bonusItems.findIndex(bi => bi.description === item.description && bi.amount === item.amount);
                                      return (
                                        <div key={originalIndex} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                                            <span className="font-medium text-slate-700">{item.description}</span>
                                            <span className="font-mono font-bold text-slate-900">{formatCurrency(item.amount)}</span>
                                        </div>
                                    )})
                                  ) : (
                                      <div className="text-center py-4 text-slate-500 italic">
                                        {bonusItems.length > 0 ? 'Không có khoản nào được chọn.' : 'Không tìm thấy khoản thu nhập nào.'}
                                      </div>
                                  )}
                              </div>
                              
                              <div className="pt-3 mt-3 border-t border-slate-200 flex justify-between items-center">
                                  <span className="font-bold text-lg text-slate-800">TỔNG CỘNG</span>
                                  <span className="font-mono font-bold text-xl text-indigo-600">{formatCurrency(totalBonus)}</span>
                              </div>
                          </div>

                          {/* Bảng phân chia */}
                          <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200/80 h-fit">
                              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                  <span className="material-symbols-outlined text-green-600">pie_chart</span>
                                  Bảng Phân Chia Thưởng
                              </h3>
                              
                              <div className="mb-6">
                                  <h4 className="text-sm font-semibold text-slate-500 uppercase mb-2">Phần Quản Lý (30%)</h4>
                                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-lg flex justify-between items-center">
                                      <span className="font-medium text-indigo-900">Quản Lý</span>
                                      <span className="font-mono font-bold text-xl text-indigo-700">{formatCurrency(managerShare)}</span>
                                  </div>
                              </div>

                              <div>
                                  <h4 className="text-sm font-semibold text-slate-500 uppercase mb-2 flex justify-between items-center">
                                      <span>Phần Nhân Sự (70%)</span>
                                      <span className="font-mono text-slate-700">{formatCurrency(staffShare)}</span>
                                  </h4>
                                  
                                  <div className="mb-3 flex items-center gap-2">
                                      <label htmlFor="deduction" className="text-sm font-medium text-slate-600 whitespace-nowrap">Trừ (Truy thu/Chi):</label>
                                      <input 
                                          id="deduction"
                                          type="text" 
                                          inputMode="numeric"
                                          value={formatNumber(bonusDeduction)}
                                          onChange={handleBonusDeductionChange}
                                          placeholder="0"
                                          className="w-full p-2 text-right text-sm border border-slate-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                                      />
                                  </div>

                                  <div className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                                      <table className="w-full text-sm text-left">
                                          <thead className="bg-slate-100 text-slate-600 font-semibold">
                                              <tr>
                                                  <th className="px-4 py-2">Tên Nhân Sự</th>
                                                  <th className="px-4 py-2 text-right">Thực Lĩnh</th>
                                              </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-200">
                                              {staffMembers.map((staff, idx) => {
                                                  const qrLink = `https://img.vietqr.io/image/${staff.bank}-${staff.account}-compact2.png?amount=${perStaffShare}&addInfo=${encodeURIComponent(`Chuyen tien thuong`)}&accountName=${encodeURIComponent(staff.name)}`;
                                                  return (
                                                      <tr key={idx}>
                                                          <td className="px-4 py-3 font-medium text-slate-800">
                                                              <div className="flex items-center justify-between">
                                                                  <span>{staff.name}</span>
                                                                  {perStaffShare > 0 && (
                                                                      <button 
                                                                          onClick={() => setQrModalData({ name: staff.name, qrLink: qrLink })}
                                                                          className="p-1 rounded-full text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500"
                                                                          title={`Tạo QR thanh toán cho ${staff.name}`}
                                                                      >
                                                                          <span className="material-symbols-outlined" style={{ verticalAlign: 'middle' }}>qr_code_scanner</span>
                                                                      </button>
                                                                  )}
                                                              </div>
                                                          </td>
                                                          <td className="px-4 py-3 text-right font-mono font-bold text-green-700">{formatCurrency(perStaffShare)}</td>
                                                      </tr>
                                                  );
                                              })}
                                          </tbody>
                                      </table>
                                  </div>
                              </div>
                          </div>
                      </div>
                  )}
              </div>
          );
      default:
        return null;
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen font-sans bg-slate-100 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl min-h-[600px] bg-white rounded-2xl shadow-xl flex flex-col md:flex-row overflow-hidden">
              {/* Left Branding Panel */}
              <div className="w-full md:w-2/5 bg-[#1F75F0] text-white p-8 sm:p-12 flex flex-col justify-center items-center text-center">
                  <img src="https://images.urbox.vn/_img_server/2025/03/19/320/1742374793_67da878a0f466.png" alt="Brand Logo" className="w-40 h-40 opacity-90 mb-6" />
                  <div className="flex items-center justify-center gap-3 mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <span className="text-xl font-bold tracking-wider uppercase">HỖ TRỢ CÔNG VIỆC</span>
                  </div>
                  <h1 className="text-4xl font-extrabold mb-3">WELCOME!</h1>
                  <p className="text-blue-100 text-lg max-w-xs">
                      Nền tảng hỗ trợ các nghiệp vụ hàng ngày của bạn.
                  </p>
              </div>

              {/* Right Form Panel */}
              <div className="w-full md:w-3/5 p-8 sm:p-12 flex flex-col justify-center">
                  <div className="w-full max-w-md mx-auto">
                      <h2 className="text-3xl font-bold text-slate-800 mb-2">
                          {authView === 'login' ? 'Đăng Nhập' : 'Tạo Tài Khoản'}
                      </h2>
                      <p className="text-slate-500 mb-8">
                          {authView === 'login' ? 'Vui lòng nhập thông tin của bạn.' : 'Điền thông tin để đăng ký.'}
                      </p>

                      {authView === 'login' ? (
                          <form onSubmit={handleLogin} className="space-y-5">
                              <div>
                                  <label htmlFor="username" className="block text-sm font-medium text-slate-700 mb-1">Tên đăng nhập</label>
                                  <div className="relative">
                                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>
                                      </div>
                                      <input id="username" name="username" type="text" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} className="appearance-none block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-[#1F75F0] focus:border-[#1F75F0] sm:text-sm"/>
                                  </div>
                              </div>
                              <div>
                                  <label htmlFor="password"className="block text-sm font-medium text-slate-700 mb-1">Mật khẩu</label>
                                  <div className="relative">
                                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
                                      </div>
                                     <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="appearance-none block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-[#1F75F0] focus:border-[#1F75F0] sm:text-sm"/>
                                  </div>
                              </div>
                              
                              {loginError && <p className="flex items-center gap-2 text-sm text-red-700 bg-red-100 p-3 rounded-md border border-red-200/50"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>{loginError}</p>}
                              {registerSuccess && <p className="flex items-center gap-2 text-sm text-green-700 bg-green-100 p-3 rounded-md border border-green-200/50"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>{registerSuccess}</p>}

                              <button type="submit" className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-[#1F75F0] hover:bg-[#1A63CC] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1F75F0] transition-colors duration-300">Đăng nhập</button>
                              
                              <p className="text-center text-sm text-slate-600">
                                 Chưa có tài khoản?{' '}
                                  <button type="button" onClick={() => { setAuthView('register'); setLoginError(''); setRegisterSuccess(''); }} className="font-medium text-[#1F75F0] hover:text-[#1A63CC] focus:outline-none">
                                      Đăng ký
                                  </button>
                              </p>
                          </form>
                      ) : (
                          <form onSubmit={handleRegister} className="space-y-4">
                              <div>
                                  <label htmlFor="new-username" className="block text-sm font-medium text-slate-700 mb-1">Tên đăng nhập</label>
                                  <div className="relative">
                                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>
                                      </div>
                                      <input id="new-username" name="new-username" type="text" required value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className="appearance-none block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-[#1F75F0] focus:border-[#1F75F0] sm:text-sm"/>
                                  </div>
                              </div>
                               <div>
                                  <label htmlFor="new-password"className="block text-sm font-medium text-slate-700 mb-1">Mật khẩu</label>
                                   <div className="relative">
                                       <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
                                       </div>
                                      <input id="new-password" name="new-password" type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="appearance-none block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-[#1F75F0] focus:border-[#1F75F0] sm:text-sm"/>
                                   </div>
                              </div>
                               <div>
                                  <label htmlFor="confirm-password"className="block text-sm font-medium text-slate-700 mb-1">Xác nhận Mật khẩu</label>
                                   <div className="relative">
                                       <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" /><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                                       </div>
                                      <input id="confirm-password" name="confirm-password" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="appearance-none block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-[#1F75F0] focus:border-[#1F75F0] sm:text-sm"/>
                                   </div>
                              </div>
                              {registerError && <p className="flex items-center gap-2 text-sm text-red-700 bg-red-100 p-3 rounded-md border border-red-200/50"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>{registerError}</p>}
                              
                              <button type="submit" className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-[#1F75F0] hover:bg-[#1A63CC] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1F75F0] transition-colors duration-300">Đăng ký</button>
                              
                               <p className="text-center text-sm text-slate-600">
                                  Đã có tài khoản?{' '}
                                  <button type="button" onClick={() => { setAuthView('login'); setRegisterError(''); }} className="font-medium text-[#1F75F0] hover:text-[#1A63CC] focus:outline-none">
                                      Đăng nhập
                                  </button>
                              </p>
                          </form>
                      )}
                  </div>
              </div>
          </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans flex flex-col">
       <header className="bg-white/80 backdrop-blur-sm shadow-sm sticky top-0 z-40 border-b border-slate-200/80">
            <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex w-full items-center h-auto sm:h-16 py-2 sm:py-0">
                    <div className="flex-shrink-0">
                        <button onClick={() => setCurrentPage('trang-chu')} className={navItemClasses('trang-chu')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 22V12h6v10" /></svg>
                            <span className="hidden sm:inline">Trang chủ</span>
                        </button>
                    </div>

                    <div className="flex-grow flex items-center justify-center flex-wrap gap-x-1 sm:gap-x-2">
                         <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>
                         <button onClick={() => handleFeatureClick('kiem-quy')} className={navItemClasses('kiem-quy')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                            <span className="hidden sm:inline">Kiểm quỹ</span>
                        </button>
                        <button onClick={() => handleFeatureClick('kiem-ke')} className={navItemClasses('kiem-ke')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                            <span className="hidden sm:inline">Kiểm kê</span>
                        </button>
                         <button onClick={() => handleFeatureClick('kiem-hang-chuyen-kho')} className={`${navItemClasses('kiem-hang-chuyen-kho')} ${isFeatureLocked('kiem-hang-chuyen-kho') ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span className="hidden sm:inline">Kiểm Hàng</span>
                        </button>
                        <button onClick={() => handleFeatureClick('kiem-tra-ton-kho')} className={`${navItemClasses('kiem-tra-ton-kho')} ${isFeatureLocked('kiem-tra-ton-kho') ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            <span className="hidden sm:inline">Tra tồn kho</span>
                        </button>
                        <button onClick={() => handleFeatureClick('thay-posm')} className={`${navItemClasses('thay-posm')} ${isFeatureLocked('thay-posm') ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span className="hidden sm:inline">Thay POSM</span>
                        </button>
                        
                        <div ref={featureMenuRef} className="relative">
                            <button onClick={() => setIsFeatureMenuOpen(!isFeatureMenuOpen)} className={`flex items-center gap-2 px-3 py-2 rounded-md font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-white text-slate-700 hover:bg-slate-100 hover:text-slate-900`}>
                                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>widgets</span>
                                <span className="hidden sm:inline">Chức năng</span>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {isFeatureMenuOpen && (
                                <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5 z-50">
                                    <button
                                        onClick={() => { handleFeatureClick('ma-qr'); setIsFeatureMenuOpen(false); }}
                                        className={`w-full text-left flex items-center gap-3 px-4 py-2 text-sm ${isFeatureLocked('ma-qr') ? 'text-slate-400 cursor-not-allowed' : 'text-slate-700 hover:bg-slate-100'}`}
                                    >
                                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>qr_code_2</span>
                                        <span>Tạo Mã QR / Barcode</span>
                                    </button>
                                    <button
                                        onClick={() => { handleFeatureClick('tinh-thuong'); setIsFeatureMenuOpen(false); }}
                                        className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                    >
                                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>paid</span>
                                        <span>Tính Thưởng</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div ref={userMenuRef} className="relative flex-shrink-0">
                         <button onClick={() => setIsUserMenuOpen(!isUserMenuOpen)} className="flex items-center justify-center h-10 px-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 focus:ring-offset-white min-w-[50px]">
                            {isAdmin ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                </svg>
                            ) : isVip ? (
                                <span className="font-bold text-xs bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded">VIP</span>
                            ) : (
                                <span className="font-bold text-xs bg-slate-300 text-slate-700 px-2 py-0.5 rounded">Free</span>
                            )}
                        </button>
                        {isUserMenuOpen && (
                            <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5 z-50">
                                <div className="px-4 py-2 border-b border-slate-100">
                                    <p className="text-xs text-slate-500">Đã đăng nhập với tên:</p>
                                    <p className="text-sm font-semibold text-slate-800 truncate flex items-center gap-2">{currentUser?.username}
                                        {isVip && <span className="font-bold text-xs bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded">VIP</span>}
                                        {isFree && <span className="font-bold text-xs bg-slate-300 text-slate-700 px-2 py-0.5 rounded">Free</span>}
                                    </p>
                                </div>
                                <button
                                    onClick={() => { setCurrentPage('thong-tin'); setIsUserMenuOpen(false); }}
                                    className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>Thông tin ứng dụng</span>
                                </button>
                                <button
                                    onClick={handleLogout}
                                    className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                    </svg>
                                    <span>Đăng xuất</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </nav>
        </header>
      <main className="w-full text-slate-800 flex flex-grow flex-col items-center p-4 sm:p-6 lg:p-8">
        {renderContent()}
      </main>
      {currentPage !== 'trang-chu' && currentPage !== 'thong-tin' && <ReportBugButton onClick={() => handleOpenBugReport(currentPage)} />}
      
      {isBugReportOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={handleCloseBugReport}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <header className="p-5 border-b border-slate-200 flex justify-between items-center flex-shrink-0">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <span className="material-symbols-outlined text-red-500">bug_report</span>
                        <span>Báo Lỗi: {bugReportPage}</span>
                    </h2>
                    <button onClick={handleCloseBugReport} className="text-slate-500 hover:text-slate-800 transition-colors rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </header>
                <form onSubmit={handleBugReportSubmit} className="p-6 overflow-y-auto space-y-5 flex-grow">
                    <div>
                        <label htmlFor="bug-summary" className="block text-sm font-semibold text-slate-700 mb-1.5">Tình trạng lỗi <span className="text-red-500">*</span></label>
                        <input
                            id="bug-summary"
                            type="text"
                            value={bugReportSummary}
                            onChange={(e) => setBugReportSummary(e.target.value)}
                            placeholder="Ví dụ: Không thể in POSM, Lỗi tính toán quỹ..."
                            className="w-full p-2 bg-white border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            required
                        />
                    </div>
                     <div>
                        <label htmlFor="bug-details" className="block text-sm font-semibold text-slate-700 mb-1.5">Nội dung chi tiết <span className="text-red-500">*</span></label>
                        <textarea
                            id="bug-details"
                            rows={5}
                            value={bugReportDetails}
                            onChange={(e) => setBugReportDetails(e.target.value)}
                            placeholder="Vui lòng mô tả các bước để tái hiện lỗi, và kết quả bạn mong đợi."
                            className="w-full p-2 bg-white border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="bug-screenshot" className="block text-sm font-semibold text-slate-700 mb-1.5">Hình ảnh lỗi</label>
                        <input
                            id="bug-screenshot"
                            type="file"
                            accept="image/*"
                            onChange={handleScreenshotChange}
                            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                        />
                        {bugReportScreenshotPreview && (
                             <div className="mt-4 p-2 border border-slate-200 rounded-lg inline-block">
                                <img src={bugReportScreenshotPreview} alt="Xem trước ảnh lỗi" className="max-h-40 rounded" />
                            </div>
                        )}
                        <p className="mt-1.5 text-xs text-slate-500">Vui lòng chụp ảnh màn hình lỗi và tải lên tại đây.</p>
                    </div>
                </form>
                <footer className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end items-center gap-3 flex-shrink-0">
                    <button type="button" onClick={handleCloseBugReport} className="px-4 py-2 text-sm bg-white text-slate-700 border border-slate-300 font-semibold rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400">
                        Hủy
                    </button>
                    <button type="submit" form="bug-report-form" onClick={handleBugReportSubmit} className="px-4 py-2 text-sm bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500">
                        Gửi Báo Lỗi
                    </button>
                </footer>
            </div>
        </div>
    )}
    
    {isVipModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={() => setIsVipModalOpen(false)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="bg-gradient-to-r from-amber-400 to-yellow-500 p-4 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <span className="material-symbols-outlined">workspace_premium</span>
                        Nâng Cấp Tài Khoản VIP
                    </h2>
                    <button onClick={() => setIsVipModalOpen(false)} className="text-white/80 hover:text-white transition-colors">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                    <p className="text-slate-600 text-sm">
                        Quét mã QR bên dưới để thanh toán <span className="font-bold text-red-600">10.000đ</span> và sử dụng VIP trong <span className="font-bold text-slate-800">30 ngày</span>.
                    </p>
                    
                    <div className="p-2 border-2 border-amber-200 rounded-xl bg-amber-50">
                        <img 
                            src={`https://img.vietqr.io/image/MB-031119939-compact2.png?amount=10000&addInfo=VIP%20${currentUser?.username}&accountName=DAO%20THE%20ANH`}
                            alt="VietQR MB