// 内置题库（题库优先于 AI，永远不被 AI 结果覆盖）
// 格式：数组，每项 { question: 题干原文（归一化前，任意格式）, answer: 答案, type: 题型 }
// 匹配方式：题干经归一化（去空白/标点/题号前缀、全角转半角、小写）后取 MD5 指纹比对
// 使用：把题库文本按下面示例填入即可；留空数组则全部走 AI

var QUESTION_BANK = [
    // 示例：
    // { type: "choice", question: "下列关于线性规划的说法正确的是", answer: "B" },
    // { type: "judge",  question: "影子价格是非负的",             answer: "对" },
    // { type: "fill",   question: "IP 地址 192.168.1.1 的默认子网掩码是", answer: "255.255.255.0" },
];
