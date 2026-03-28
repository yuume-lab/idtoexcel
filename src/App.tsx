/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  Upload, 
  FileSpreadsheet, 
  Trash2, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  Copy,
  Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface IDCardData {
  id: string; // Internal unique ID
  name: string;
  gender: string;
  ethnicity: string;
  birthDate: string;
  address: string;
  idNumber: string;
  age: string;
  phone: string;
  original: string;
  notes: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  error?: string;
  previewUrl?: string;
}

const ID_CARD_SCHEMA = null; // Removed, handled on server

export default function App() {
  const [items, setItems] = useState<IDCardData[]>([]);
  const [tableName, setTableName] = useState('2020年11月15日-20日巴马双飞6日');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Gemini Logic ---
  const processImage = async (file: File, itemId: string, useLocal: boolean) => {
    try {
      setItems(prev => prev.map(item => 
        item.id === itemId ? { ...item, status: 'processing' } : item
      ));

      if (useLocal) {
        // --- Local OCR (Tesseract.js) ---
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker('chi_sim+eng', 1, {
          workerPath: 'https://lf26-cdn-tos.bytecdntp.com/cdn/expire-1-M/tesseract.js/5.0.3/worker.min.js',
          langPath: 'https://lf26-cdn-tos.bytecdntp.com/cdn/expire-1-M/tessdata/4.0.0_fast',
          corePath: 'https://lf26-cdn-tos.bytecdntp.com/cdn/expire-1-M/tesseract.js-core/5.0.3/tesseract-core.wasm.js',
        });
        const { data: { text } } = await worker.recognize(file);
        await worker.terminate();
        
        // Simple regex fallback for Tesseract
        const idMatch = text.replace(/\s+/g, "").match(/\d{17}[\dX]/);
        const nameMatch = text.match(/(姓名|姓各|娃各|姓|名)[:：]?([\u4e00-\u9fa5]{2,4})/);
        
        const idNum = idMatch ? idMatch[0] : '';
        let calculatedAge = '';
        if (idNum.length === 18) {
          calculatedAge = (new Date().getFullYear() - parseInt(idNum.substring(6, 10))).toString();
        }

        setItems(prev => prev.map(item => 
          item.id === itemId ? { 
            ...item, 
            name: nameMatch ? nameMatch[2] : '未识别',
            idNumber: idNum,
            age: calculatedAge,
            status: 'success' 
          } : item
        ));
        return;
      }

      // --- Server-side OCR ---
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      const base64Data = await base64Promise;

      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data, mimeType: file.type })
      });

      if (!response.ok) {
        let errorMessage = '识别失败';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // If the server returns a non-JSON response (like a 502 Bad Gateway HTML page from Vercel)
          errorMessage = `服务器错误 (${response.status}): ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      let calculatedAge = '';
      if (result.idNumber && result.idNumber.length === 18) {
        calculatedAge = (new Date().getFullYear() - parseInt(result.idNumber.substring(6, 10))).toString();
      }

      setItems(prev => prev.map(item => 
        item.id === itemId ? { 
          ...item, 
          ...result, 
          age: calculatedAge,
          status: 'success' 
        } : item
      ));
    } catch (error) {
      console.error("OCR Error:", error);
      setItems(prev => prev.map(item => 
        item.id === itemId ? { 
          ...item, 
          status: 'error', 
          error: error instanceof Error ? error.message : '识别失败' 
        } : item
      ));
    }
  };

  // --- Handlers ---
  const [useLocalOCR, setUseLocalOCR] = useState(false);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    addFiles(files);
  };

  const addFiles = (files: File[]) => {
    const newItems: IDCardData[] = files.map(file => ({
      id: Math.random().toString(36).substring(7),
      name: '',
      gender: '',
      ethnicity: '',
      birthDate: '',
      address: '',
      idNumber: '',
      age: '',
      phone: '',
      original: '',
      notes: '',
      status: 'pending',
      previewUrl: URL.createObjectURL(file)
    }));

    setItems(prev => [...prev, ...newItems]);
    
    // Auto start processing
    files.forEach((file, index) => {
      processImage(file, newItems[index].id, useLocalOCR);
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => (f as File).type.startsWith('image/')) as File[];
    addFiles(files);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const updateField = (id: string, field: keyof IDCardData, value: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const exportToExcel = () => {
    // 1. Prepare title and headers
    const title = [[tableName]];
    const headers = [['序号', '姓名', '性别', '身份证号', '年龄', '手机号码', '备注']];
    
    // 2. Prepare data rows
    const dataRows = items.map((item, index) => [
      index + 1,
      item.name,
      item.gender,
      item.idNumber,
      item.age,
      item.phone,
      item.notes
    ]);

    // 3. Combine all rows
    const allRows = [...title, ...headers, ...dataRows];

    // 4. Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(allRows);

    // 5. Apply Merges (Title row across all columns)
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } } // Merge A1 to G1
    ];

    // 6. Set column widths
    ws['!cols'] = [
      { wch: 6 },  // 序号
      { wch: 12 }, // 姓名
      { wch: 8 },  // 性别
      { wch: 22 }, // 身份证号
      { wch: 6 },  // 年龄
      { wch: 15 }, // 手机号码
      { wch: 20 }, // 备注
    ];

    // 7. Create workbook and save
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "身份证数据");
    XLSX.writeFile(wb, `${tableName}.xlsx`);
  };

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl shadow-sm border border-black/5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">身份证智能解析</h1>
            <p className="text-sm text-black/50 mt-1">基于 Gemini AI 的高精度 OCR 识别工具</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[#F5F5F5] px-3 py-2 rounded-xl border border-black/5">
              <span className="text-xs font-medium text-black/40">本地 OCR</span>
              <button 
                onClick={() => setUseLocalOCR(!useLocalOCR)}
                className={cn(
                  "w-10 h-5 rounded-full relative transition-colors",
                  useLocalOCR ? "bg-green-500" : "bg-black/10"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                  useLocalOCR ? "left-6" : "left-1"
                )} />
              </button>
            </div>
            <input 
              type="text" 
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="表格名称"
              className="bg-[#F5F5F5] border-none rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-black/5 outline-none w-48"
            />
            <button 
              onClick={exportToExcel}
              disabled={items.length === 0}
              className="flex items-center gap-2 bg-black text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-black/80 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              导出 Excel
            </button>
          </div>
        </header>

        {/* Upload Zone */}
        <div 
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="group relative cursor-pointer"
        >
          <div className="absolute inset-0 bg-black/5 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative bg-white border-2 border-dashed border-black/10 rounded-3xl p-12 flex flex-col items-center justify-center text-center transition-all hover:border-black/20 hover:bg-black/[0.01]">
            <div className="w-16 h-16 bg-[#F5F5F5] rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Upload className="w-8 h-8 text-black/40" />
            </div>
            <h3 className="text-lg font-medium">点击或拖拽身份证照片</h3>
            <p className="text-sm text-black/40 mt-2 max-w-xs">支持多张图片批量识别，建议光线充足，文字清晰</p>
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={onFileChange}
              multiple 
              accept="image/*" 
              className="hidden" 
            />
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Table Section */}
          <div className="lg:col-span-12 space-y-4">
            <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
              <div className="p-6 border-b border-black/5 flex items-center justify-between">
                <h2 className="font-medium flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5" />
                  识别列表
                  <span className="bg-[#F5F5F5] text-xs px-2 py-1 rounded-full text-black/60">{items.length}</span>
                </h2>
                <button 
                  onClick={() => setItems([])}
                  className="text-xs text-red-500 hover:underline flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> 清空列表
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="bg-[#F5F5F5]/50 text-black/40 font-medium">
                      <th className="px-4 py-4 font-medium">预览</th>
                      <th className="px-4 py-4 font-medium">姓名</th>
                      <th className="px-4 py-4 font-medium">性别</th>
                      <th className="px-4 py-4 font-medium">身份证号</th>
                      <th className="px-4 py-4 font-medium">年龄</th>
                      <th className="px-4 py-4 font-medium">手机号码</th>
                      <th className="px-4 py-4 font-medium">备注</th>
                      <th className="px-4 py-4 font-medium">状态</th>
                      <th className="px-4 py-4 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    <AnimatePresence mode="popLayout">
                      {items.map((item, idx) => (
                        <motion.tr 
                          key={item.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="group hover:bg-black/[0.01] transition-colors"
                        >
                          <td className="px-4 py-4">
                            <div className="w-12 h-8 rounded-md bg-[#F5F5F5] overflow-hidden border border-black/5">
                              {item.previewUrl ? (
                                <img src={item.previewUrl} alt="preview" className="w-full h-full object-cover" />
                              ) : (
                                <ImageIcon className="w-full h-full p-2 text-black/20" />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <input 
                              type="text" 
                              value={item.name}
                              onChange={(e) => updateField(item.id, 'name', e.target.value)}
                              className="bg-transparent border-none p-0 focus:ring-0 w-full font-medium"
                              placeholder="姓名"
                            />
                          </td>
                          <td className="px-4 py-4">
                            <input 
                              type="text" 
                              value={item.gender}
                              onChange={(e) => updateField(item.id, 'gender', e.target.value)}
                              className="bg-transparent border-none p-0 focus:ring-0 w-full"
                              placeholder="性别"
                            />
                          </td>
                          <td className="px-4 py-4 font-mono text-xs">
                            <input 
                              type="text" 
                              value={item.idNumber}
                              onChange={(e) => updateField(item.id, 'idNumber', e.target.value)}
                              className="bg-transparent border-none p-0 focus:ring-0 w-full"
                              placeholder="身份证号"
                            />
                          </td>
                          <td className="px-4 py-4">
                            <input 
                              type="text" 
                              value={item.age}
                              onChange={(e) => updateField(item.id, 'age', e.target.value)}
                              className="bg-transparent border-none p-0 focus:ring-0 w-full"
                              placeholder="年龄"
                            />
                          </td>
                          <td className="px-4 py-4">
                            <input 
                              type="text" 
                              value={item.phone}
                              onChange={(e) => updateField(item.id, 'phone', e.target.value)}
                              className="bg-transparent border-none p-0 focus:ring-0 w-full"
                              placeholder="手机号码"
                            />
                          </td>
                          <td className="px-4 py-4">
                            <input 
                              type="text" 
                              value={item.notes}
                              onChange={(e) => updateField(item.id, 'notes', e.target.value)}
                              className="bg-transparent border-none p-0 focus:ring-0 w-full"
                              placeholder="备注"
                            />
                          </td>
                          <td className="px-4 py-4">
                            {item.status === 'processing' && (
                              <div className="flex items-center gap-2 text-blue-500">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="text-xs">识别中...</span>
                              </div>
                            )}
                            {item.status === 'success' && (
                              <div className="flex items-center gap-2 text-green-500">
                                <CheckCircle2 className="w-4 h-4" />
                                <span className="text-xs">成功</span>
                              </div>
                            )}
                            {item.status === 'error' && (
                              <div className="flex items-center gap-1 text-red-500" title={item.error}>
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                <span className="text-xs truncate max-w-[100px]">{item.error}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <button 
                              onClick={() => removeItem(item.id)}
                              className="p-2 text-black/20 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-6 py-12 text-center text-black/30 italic">
                          暂无数据，请上传图片开始识别
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
