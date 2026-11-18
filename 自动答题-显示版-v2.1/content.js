// 隐蔽复制粘贴助手 - Content Script v4.0
// 策略：默认不干扰页面，只在用户主动触发时才解锁
// 不再自动注入主世界脚本，避免破坏页面功能

(function() {
    'use strict';

    if (window.__stealthHelperV4) return;
    window.__stealthHelperV4 = true;

    console.log('[助手] Content script v4.0 启动');

    let isEnabled = true;
    let isUnlocked = false;
    let statusPanel = null;
    let hideTimeout = null;
    const isTopFrame = window === window.top;

    // ========== 1. 状态面板 ==========
    function createStatusPanel() {
        if (statusPanel || !isTopFrame) return;
        statusPanel = document.createElement('div');
        statusPanel.id = '__stealth_status__';
        statusPanel.style.cssText = 
            'position:fixed!important;bottom:20px!important;right:20px!important;' +
            'padding:6px 12px!important;background:rgba(0,0,0,0.75)!important;' +
            'color:#fff!important;font-size:13px!important;' +
            'font-family:system-ui,sans-serif!important;' +
            'z-index:2147483647!important;opacity:0!important;transition:opacity 0.15s!important;' +
            'pointer-events:none!important;border-radius:4px!important;';
        const append = () => document.body && document.body.appendChild(statusPanel);
        document.body ? append() : document.addEventListener('DOMContentLoaded', append);
    }

    function showStatus(text, isError = false) {
        if (!isTopFrame) return;
        if (!statusPanel || !statusPanel.parentNode) { statusPanel = null; createStatusPanel(); }
        if (!statusPanel) return;
        statusPanel.textContent = text;
        statusPanel.style.background = isError ? 'rgba(180,50,50,0.85)' : 'rgba(0,0,0,0.75)';
        statusPanel.style.opacity = '1';
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => statusPanel && (statusPanel.style.opacity = '0'), 1500);
    }

    // ========== 2. 轻量解锁 ==========
    function lightUnlock() {
        document.oncopy = null;
        document.onpaste = null;
        document.oncut = null;
        document.onselectstart = null;
        document.oncontextmenu = null;
        
        document.querySelectorAll('[oncopy],[onpaste],[oncut],[onselectstart],[oncontextmenu]').forEach(el => {
            el.removeAttribute('oncopy');
            el.removeAttribute('onpaste');
            el.removeAttribute('oncut');
            el.removeAttribute('onselectstart');
            el.removeAttribute('oncontextmenu');
        });
        
        let style = document.getElementById('stealth-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'stealth-style';
            style.textContent = '*,*::before,*::after{-webkit-user-select:auto!important;user-select:auto!important;-moz-user-select:auto!important;}';
            (document.head || document.documentElement).appendChild(style);
        }
        
        isUnlocked = true;
    }

    // ========== 3. iframe处理 ==========
    function handleIframes() {
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                const doc = iframe.contentDocument;
                if (doc && !doc.__lightUnlocked) {
                    doc.__lightUnlocked = true;
                    doc.oncopy = null;
                    doc.onpaste = null;
                    doc.oncut = null;
                    doc.onselectstart = null;
                    doc.oncontextmenu = null;
                    
                    if (!doc.getElementById('stealth-style')) {
                        const s = doc.createElement('style');
                        s.id = 'stealth-style';
                        s.textContent = '*{user-select:auto!important;-webkit-user-select:auto!important;}';
                        (doc.head || doc.documentElement).appendChild(s);
                    }
                    doc.addEventListener('keydown', handleKeydown, true);
                }
            } catch (e) {}
        });
    }

    // ========== 4. 复制功能 ==========
    function stealthCopy() {
        if (!isUnlocked) lightUnlock();
        
        let text = '';
        const iframe = findActiveIframe();
        if (iframe) {
            try {
                const doc = iframe.contentDocument;
                const sel = doc?.getSelection();
                text = sel?.toString().trim() || '';
            } catch (e) {}
        }
        
        if (!text) {
            const sel = window.getSelection();
            text = sel?.toString().trim() || '';
        }
        
        if (!text) {
            const el = document.activeElement;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
                const s = el.selectionStart || 0;
                const e = el.selectionEnd || 0;
                if (s !== e) text = el.value.substring(s, e);
            }
        }
        
        if (!text) {
            showStatus('无选中内容', true);
            return;
        }
        
        navigator.clipboard.writeText(text)
            .then(() => showStatus('已复制'))
            .catch(() => showStatus('复制失败', true));
    }

    // ========== 5. 粘贴功能 ==========
    function stealthPaste() {
        const iframe = findActiveIframe();
        if (iframe) {
            try {
                const doc = iframe.contentDocument;
                if (doc) {
                    pasteToDocument(doc);
                    return;
                }
            } catch (e) {}
        }
        
        const el = document.activeElement;
        if (!el) {
            showStatus('请先点击输入框', true);
            return;
        }
        
        navigator.clipboard.readText().then(text => {
            if (!text) {
                showStatus('剪贴板为空', true);
                return;
            }
            
            if (el.isContentEditable) {
                document.execCommand('insertText', false, text);
                showStatus('已粘贴');
            } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                const s = el.selectionStart || 0;
                const e = el.selectionEnd || 0;
                el.value = el.value.slice(0, s) + text + el.value.slice(e);
                el.selectionStart = el.selectionEnd = s + text.length;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                showStatus('已粘贴');
            } else {
                showStatus('请先点击输入框', true);
            }
        }).catch(() => showStatus('粘贴失败', true));
    }

    function pasteToDocument(doc) {
        navigator.clipboard.readText().then(text => {
            if (!text) {
                showStatus('剪贴板为空', true);
                return;
            }
            if (doc.body) doc.body.focus();
            let ok = doc.execCommand('insertText', false, text);
            if (!ok) ok = doc.execCommand('insertHTML', false, text.replace(/\n/g, '<br>'));
            showStatus(ok ? '已粘贴' : '粘贴失败', !ok);
        }).catch(() => showStatus('粘贴失败', true));
    }

    function findActiveIframe() {
        if (document.activeElement?.tagName === 'IFRAME') {
            try {
                const doc = document.activeElement.contentDocument;
                if (doc?.body?.contentEditable === 'true') return document.activeElement;
            } catch (e) {}
        }
        
        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                const doc = iframe.contentDocument;
                if (doc?.hasFocus?.() && doc.body?.contentEditable === 'true') return iframe;
            } catch (e) {}
        }
        
        const editable = [...document.querySelectorAll('iframe')].filter(iframe => {
            try { return iframe.contentDocument?.body?.contentEditable === 'true'; } catch (e) { return false; }
        });
        return editable.length === 1 ? editable[0] : null;
    }

    // ========== 6. 快捷键处理 ==========
    function handleKeydown(e) {
        if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
        
        const key = e.key.toLowerCase();
        
        if (key === 'q') {
            e.preventDefault();
            e.stopImmediatePropagation();
            isEnabled = !isEnabled;
            showStatus(isEnabled ? '已开启' : '已关闭');
            return false;
        }
        
        if (key === 's') {
            e.preventDefault();
            e.stopImmediatePropagation();
            lightUnlock();
            handleIframes();
            showStatus('已解锁');
            return false;
        }
        
        if (!isEnabled) return;
        
        if (key === 'c') {
            e.preventDefault();
            e.stopImmediatePropagation();
            stealthCopy();
            return false;
        }
        
        if (key === 'v') {
            e.preventDefault();
            e.stopImmediatePropagation();
            stealthPaste();
            return false;
        }
        
        if (key >= '1' && key <= '9') {
            e.preventDefault();
            e.stopImmediatePropagation();
            copyPreset(parseInt(key));
            return false;
        }
    }

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', handleKeydown, { capture: true, passive: false });
        window.addEventListener('keydown', handleKeydown, { capture: true, passive: false });
    }

    // ========== 7. 预设内容 ==========
    const presetNames = { 
        1: '预设1', 2: '预设2', 3: '预设3', 4: '预设4', 5: '预设5',
        6: '预设6', 7: '预设7', 8: '预设8', 9: '预设9'
    };


    const presetContents = {
        1: `
A
按照实际的数据传送技术，交换网络又可分为电路交换网、报文交换网和分组交换网。

B
0比特插入/删除方法规定，在两个标志字段为F之间的比特序列中，如果检查出连续的5个1，不管它后面的比特位是0或1，都增加1个0。
10000000000010110000001100011110表示的ip地址是：128.11.3.30。
本地域名服务器向根域名服务器的查询通常采用的是迭代查询。
编码指的是把数字信号转换为另一种形式的：数字信号。
标识、标志和片偏移主要用于数据包的分片。
BSC被看成是哪种类型的数据链路协议：面向字符的。
波特率等于：.每秒钟可能发生的信号变化的次数。
报文交换技术说法不正确的是：报文交换方式适用于语言连接或交互式终端到计算机的连接。
标准的B类IP地址使用16位二进制数表示网络号。

C
从技术角度看，带宽是指传输信道的最高与最低频率之差。
传输层可以通过标识不同的应用：端口号。
传输控制协议TCP提供面向连接的、可靠的数据传输服务，其数据传输的单位是：报文段。
传输控制协议TCP提供面向连接的、可靠的数据传输服务，其数据传输的单位是：报文段。
CSMA/CD发送流程为：先听后发，边听边发，冲突停止，延迟重发。
串行数据通信的方向性结构有三种，即单工、半双工和全双工。
从协议分析的角度，WWW服务的第一步操作是浏览器对服务器的：请求域名解析。
常用的传输介质中，带宽最宽、信号传输衰减最小、抗干扰能力最强的一类传输介质是：光纤。
采用全双工通信方式，数据传输的方向性结构为：可以在两个方向上同时传输。
从源向目的传送数据段的过程中，TCP使用什么机制提供流量控制：窗口大小。

D
电磁波在以下传输介质中传输距离最快的是：光纤。
到达通信子网中某一部分的分组数量过多，使得该部分乃至整个网络性能下降的现象，称为拥塞现象。
对地址转换协议（ARP）描述正确的是：.ARP是采用广播方式发送。
DHCP使用C/S模式，需要IP地址的主机在启动时就向DHCP服务器广播发送发现报文DHCPDISCOVER。DHCP服务器从地址池中取一个地址分配给该主机，并向网络中广播DHCPOFFER。客户机如果接受相关参数，则通过广播DHCPREQUEST报文向服务器请求提供该IP地址，服务器广播DHCPACK确认报文，将IP地址分配给客户机。
多路复用器的主要功能是：结合来自两条或更多条线路的传输。
第六章 应用层 11.DHCP使用C/S模式，需要IP地址的主机在启动时就向DHCP服务器广播发送发现报文DHCPDISCOVER,目的地址是255.255.255.255，主机地址是0.0.0.0。
DNS的作用是将域名地址解析为IP地址。
对于CSMA/CD而言,为了确保发送站点在传输时能检测到可能存在的冲突，数据帧的传输时延至少要等于信号传播时延的：2倍。
对于CSMA/CD而言,为了确保发送站点在传输时能检测到可能存在的冲突，数据帧的传输时延至少要等于信号传播时延的：2倍。
对于复杂的计算机网络最好的组织方式是层次结构模型，将计算机网络层次结构模型和各层协议的集合定义为体系结构。
当一台主机从一个网络移到另一个网络时，以下说法正确的是：必须改变它的IP 地址，但不需改动MAC 地址。
调制解调技术主要使用在通信方式中：模拟信道传输数字数据。

G
规定，下列为有效的MAC帧：长度在64－1518字节之间的MAC帧。
关于VPN，叙述错误的是：VPN可用于内部连接外网。
广域网的英文缩写为WAN。
关于无分类域间路由选择CIDR，正确的说法是：把网络前缀都相同的连续的IP地址组成一个CIDR地址块。
各种网络在物理层互连时要求：数据传输率和链路协议都相同。

H
互联网的核心部分描述正确的是：互联网的核心部分由许多网络和把它们连接起来的路由器组成的。
互联网上路由器的每个接口都要分配一个 IP地址。
互联网主要由一系列的组件和技术构成，其网络协议核心是：TCP/IP。
http服务器默认端口是80。

I
IEEE802.11标准是无线局域网标准。
IEEE802.3标准是：CSMA/CD访问方法和物理层规范。
IEEE参考模型将OSI数据链路层分为LLC和MAC两个子层。
Internet的网络层含有四个重要的协议，分别为：IP，ICMP，ARP，RARP。
Internet网络协议核心是：TCP/IP D．SLIP。
IP地址128.14.35.7/20 的子网掩码是：255.255.240.0。
IP地址块56.67.79.128/28，59.67.79.144/28和59.67.79.160/27经过汇聚后的地址数为：62。
IP地址是一个32位的二进制，它通常采用点分：十进制数表示。
IPv6的地址长度是128位，支持即插即用（即自动配置），因此不需要使用DHCP。
IPv6将32位地址空间扩展到：128 位。
IP协议是无连接的，其信息传输方式是：数据报。
ISO提出OSI模型是为了：克服多厂商网络固有的通信问题。
ISP指什么：互联网服务提供者。

J
802.11局域网的MAC层使用的协议是：CSMA/CA。
基带信号往往包含较多的低频分量，甚至有直流分量，而许多信道不能传输这种低频分量或直流分量，必须对基带信号进行操作 ：调制。
假定一条线路每1/16s采样一次，每个可能的信号变化都运载3bit的信息，问传输速率是：48 b/s。
交换机器工作在网络体系结构的：数据链路层。
交换式局域网的核心设备是交换机。
计算机网络的主要功能有：、资源共享和进行分布处理：.数据传输。
计算机网络是以能够相互共享资源的方式互联起来的自治计算机系统的集合。
计算机网络通信采用同步和异步两种方式，但传送效率最高的是：同步方式。
计算机网络通信系统是：数据通信系统。
计算机网络中常用的三种有线媒体是同轴电缆、双绞线和光纤。
计算机网络中可以共享的资源包括：硬件、软件、数据、通信信道。
集线器工作在网络体系结构的：物理层。
具有不同网络号的局域网必须使用进行互连：路由器。
局域网常见的拓扑结构有星型、环型、总线型等。
局域网从介质访问控制方法的角度可以分两类：共享介质局域网和交换式局域网。
局域网具有的几种典型的拓扑结构中，一般不含：全连接网型。

K
快速以太网的传输速率能达到100Mbps。
`,
        2: `L
流量控制实际上是对的控制：发送方数据流量。
lP数据报穿越因特网过程中有可能被分片。在IP数据报分片以后，通常由目的主机负责IP数据报的重装。
路由表包含的一个非常特殊的静态路由,叫做默认路由。
利用滑动窗口机制可以很方便地在TCP连接上实现对发送方的流量控制。
路由器属于以下哪一层的设备：网络层。
来自信源的信号被称为：基带信号。
两种最常使用的多路复用技术是：频分多路复用和时分多路复用。

M
MAC地址由位二进制构成：48。
曼彻斯特编码是一种同步方式为自同步的编码方案。
某企业产品部的IP地址块211.168.15.192/26，市场部的IP地址块为211.168.15.160/27，财务部的IP地址块为211.168.15.128/27，这三个地址块经过汇聚后的地址数为：211.168.15.128/25。
某自治系统采用RIP协议，若该自治系统内的路由器R1收到其邻居路由器R2的距离矢量，距离矢量中包含信息<net1,16>，则可能得出的结论是：R1不能经过R2到达net1。

N
1983年TCP/IP协议成为ARPANET上的标准协议，人们把1983年作为因特网的诞生时间。
奈奎斯特准则表明，在带宽W（Hz）的低信道中，若不考虑噪声影响，则码元的传输的最高速率是2W。

O
OSI参考模型采用了7层的体系结构。
OSI模型的物理层负责下列哪一种功能：定义连接到介质的特征。

P
Ping命令是基于协议实现的，而该协议是在IP层实现的：ICMP。
PPP协议是哪一层的协议：数据链路层。
PPP帧的信息字段的长度是可变的，但不能超过1500B。
PPP帧格式的开头和结尾都是1字节的标志字段，其值用十六进制表示等于7E；地址段的值设置成等于十六进制的FF；协议字段用2个字节指明高层协议；控制段的值设置成等于十六进制的03。

R
如果路由表发生错误，数据报可能进入循环路径，无休止地在网络中流动。利用IP报头中的生存周期可以防止这一情况的发生。
RIP协议是属于距离矢量路由选择算法，OSPF协议被称为链路状态算法。
RIP协议使用运输层的UDP协议进行传送。
route 命令的核心作用是：管理主机的路由表，实现路由信息的添加、删除或查看。
若数据链路的发送窗口为4,在发送3号帧，并接收到2号帧的确认帧后，发送方还可以连续发几帧：3。
若网络形状是由站点和连接站点的链路组成的一个闭合环,则称这种拓扑结构为：环形拓扑。

S
192.168.20.5属于地址：C类。
生成多项式为P（x）= X5+X3+1，则CRC的冗余码是位的比特序列：5。
生成多项式为P（x）= X6 +X5+X3+1，则生成多项式的比特序列是1101001。
设发送信息M=（110）,选用的生成多项式G(X)=1+X 2+X 3+X 4,则其循环码字为：1001。
市话网在数据传输期间，在源节点与目的节点之间有一条利用中间节点构成的物理连接线路。这种市话网采用技术：电路交换。
数据链路层包括封装成帧、透明传输和差错控制三个基本功能。
数据链路层广泛使用的是CRC的检错技术。
数据链路层流量控制最适合采用：滑动窗口协议。
数据链路层协议有多种，但有三个基本问题则是共同的。这三个基本问题是封装成帧、透明传输和差错检测。
世界上很多国家都相继组建了自己国家的公用数据网，现有的公用数据网大多采用：分组交换方式。
数据在通信线路（传输媒体）上的传输媒体一般都是，即逐个比特按照时间顺序传输：串行传输。
数据在网络中经历的总时延就是发送时延、传播时延、处理时延、排队时延之和，但是对于当前计算机网络中总时延的数值基本上是由决定的：发送时延。
使用ARP命令可以：显示和修改IP地址与物理地址之间的映射关系。
使用netstat命令可以：查看本地主机的网络连接状态、路由表、接口统计等网络相关信息。
使用tracert命令的主要作用是：用于确定IP数据包访问目标所采取的路径。
随着电信和信息技术的发展，国际上出现了所谓"三网融合"的趋势，下列不属于三网之一的是：卫星通信网。

T
TCP报文段中序号字段指的是：.数据部分第一个字节。
TCP报文中确认序号指的是：.期望收到的第一个字节序号。
TCP报文中确认序号指的是：期望收到的第一个字节序号。
TCP和UDP协议的相似之处是：传输层协议。
TCP/IP参考模型中,传输层的两个重要协议是TCP和UDP。
TCP/IP协议包括网络接口层、网际层、运输层和：应用层。
TCP进行拥塞控制的算法有四种，即慢开始、拥塞避免、快重传和快恢复。
TCP协议中，连接管理的方法为：三次握手机制。
TCP重传计时器设置的重传时间：大于平均往返时延。
TCP在IP的基础上，提供端到端的面向连接的可靠传输服务。
通过为多个信道分配互不重叠的时间片来实现多路复用技术的是：时分多路复用。
通信系统必须具备的三个基本要素是：信源、通信媒体、信宿。
同轴电缆与双绞线相比，同轴电缆的抗干扰能力：强。

U
UDP协议校验的数据是：首部＋数据。

W
32位全为1(255.255.255.255)的IP地址叫做有限广播地址，用于本网广播。
完成路径选择功能是在OSI模型的：网络层。
无分类编址 CIDR：128.14.35.7/20，表示有12位主机号。
为进行网络中的数据交换而建立的规则、标准或约定称为网络协议。
物理层考虑的是怎样才能在连接各种计算机的传输媒体上传输数据比特流。
网络层提供面向连接服务的称为虚电路服务，提供无连接的服务称为：.数据报服务。
网络层为主机之间提供逻辑通信，而运输层为应用进程间提供端到端的逻辑通信。
网络体系结构可以定义为：建立和使用通信硬件和软件的一套规则和规范。
网络协议主要要素为：语法、语义、同步。
网络由若干结点和连接这些结点的链路组成。

X
信道的带宽为2000Hz，则码元传输的最高速率是多少：4000Hz。
下列不属于路由选择协议的是：ICMP。
下列关于路由信息协议（RIP）的描述中，错误的是：矢量V标识该路由器可以到达的目的网络或目的主机的跳数。
下列关于OSPF的描述中，错误的是：在一个区域内的路由器数一般不超过24个。
下列关于Serv-UFTP服务器配置管理的描述中，正确的是：配置服务器的IP地址时，若为空则代表该服务器的所有IP地址。
下列关于外部网关协议BGP的描述中，错误的是：一个BGP发言人使用UDP与其他自治系统中的BGP发言人交换路由信息。
下列关于Win2003Server系统下WWW服务器配置的描述中，正确的是：网站性能选项中，带宽限制选项限制该网站的可使用带宽。
下列关于Windows系统下HTTP服务器的描述中，错误的是：Web站点必须配置静态IP地址 设置域名或指定端口。
下列关于Windows系统下HTTP服务器的描述中，错误的是：Web站点必须配置静态IP地址 设置域名或指定端口。
下列关于综合布线系统的描述中，错误的是：嵌入式安装插座用来连接楼层配线架。
下列哪一项不能描述模拟信号：有两个不同的状态。
下列哪一项描述了网络体系结构中的分层概念：A和C。
下列哪一项最好地描述了基带信号：.信号以原始的状态传输。
下列哪一项最好地描述了循环冗余检验的特征：.查出99%以上的差错。
下列哪一种传输方式被用于计算机内部的数据传输：并行。
下列哪种错误检查方法常被用来在面向字符的传输协议中产生块检查字符（BCC）：水平奇偶检验。
下列只能简单再生信号的设备是：中继器。
下面协议中，用于电子邮件Email传输控制的是：SMTP。
虚拟局域网其实只是局域网给用户提供的一种服务，而不是一种新型局域网。
学校校园网属于以下哪一类网络：局域网。
小于的TCP/UDP端口号已保留与现有服务一一对应，此数字以上的端口号可自由分配：1024。
协议是（D）之间进行通信的规则或约定：相邻实体。
协议是之间进行通信的规则或约定：不同结点对等实体。
校园网内一台计算机只有使用IP地址而无法使用域名访问某个外部服务器，造成这种情况的原因不可能的是：该计算机与DNS服务器不在同一子网。

Y
3以太网最小传送的帧长度为64个字节。
用表示在单位时间内通过某个网络（或信道、接口）的数据量：吞吐量。
一个10Mbit/s的适配器，与另外两个10M/100Mbit/s 的适配器通过集线器互联，集线器工作的速率是10 Mbit/s。
一个数据报长度为4000字节（固定头部长度）。现在经过一个网络传送，但此网络能够传送的最大分组长度为1500字节，若划分3个分组，请问各分组的数据片段长度：.1480字节 1480字节 1020字节。
一个VLAN可以看作是一个：广播域。
一个网络协议主要由语法、语义及同步等三要素组成。
依据香农公式，信道的极限信息传输速率与有关：信道中的信噪比。
域名地址中.GOV表示 政府机构。
域名系统DNS是一个分布式数据库系统。
用双绞线连接电脑和交换机，用以下哪种类型的线：直通线。
拥塞控制就是防止过多的数据注入到网络中，这样可以使网络中的路由器或链路不致过载。
以太网交换机不使用共享总线，没有碰撞问题，因此不使用CSMA/CD协议，而是以全双工方式工作。
以太网交换机是通过来解决兜圈子问题：生成树协议STP。
以太网媒体访问控制技术CSMA/CD的机制是：争用带宽。
以太网在发送数据时，如果前个字节没有发生冲突，则后续数据不会发生冲突 ：64。
因特网中完成域名地址和IP地址转换的系统是：DNS。
以太网征用期的长度为：51.2us。
以下不属于信道复用技术的是：XDFY。
以下各项中,不是数据报操作特点的是：使所有分组按顺序到达目的端系统。
以下关于100BASE-T的描述错误的是：采用5 类UTP，其最大传输距离为185M。
以下关于100BASE-T的描述中错误的是：采用5 类UTP，其最大传输距离为185M。
以下关于MAC的说法中错误的是：MAC地址在每次启动后都会改变。
以下关于MAC的说法中错误的是：MAC地址在每次启动后都会改变。
以下关于MAC的说法中错误的是：MAC地址在每次启动后都会改变。
以下关于TCP/IP协议的描述中，哪个是错误的：TCP/IP协议属于应用层。
以下命令中,可以同时查看到本机IP地址和MAC地址的命令是：ipconfig /all。
以下哪个IP地址代表的是本机：127.0.0.1。
有一18位基带信号111000101001010101，现采用6个比特为一组的码元传送，那么此基带信号一共有 3个码元。
有一18位基带信号111000101001010101，现采用9个比特为一组的码元传送，那么此基带信号一共有 2个码元。
已知 IP 地址是 128.14.35.7/20，则此IP所在网络的网络地址是：128.14.32.0。

Z
在802.11局域网的MAC层，可以使用CSMA/CD协议的CSMA，但不能使用CD，而是使用CA，从而很好地解决了隐蔽站和暴露站问题。
在AS内部，Internet推荐使用的路由协议是：OSPF。
在串行传输中，所有的数据字符的比特：在传输介质上一次传输一位。
制订互联网的正式标准要经过以下阶段：互联网草案、建议标准、互联网标准。
自带同步时钟信号的典型编码是：曼彻斯特编码。
在Internet上浏览时，浏览器和WWW服务器之间传输网页使用的协议是：HTTP。
在IP协议中用来进行组播的IP地址是何类地址：D类。
主机甲和主机乙之间已建立一个TCP连接，双方持续有数据传输，且数据无差错与丢失。若甲收到1个来自乙的TCP段，该段的序号为1913、确认序号为2046、有效载荷为100字节，则甲立即发送给乙的TCP段的序号和确认序号分别是：2046、2013。
在计算机网络中，所有的计算机均连接到一条通信传输线路上，在线路两端连有防止信号反射的装置，这种连接结构被称为：总线结构。
在计算机网络中，用来表示网络的通信线路传送数据的能力，因此它表示在单位时间内从网络中的某一点到另一点所能通过的"最高数据率"：带宽。
在进行文件传输时，FTP的客户和服务器之间建立两个并行的TCP连接：控制连接和数据连接。
在OSI参考模型的物理层、数据链路层、网络层传送的数据单位分别为：比特、帧、分组。
在OSI七层结构模型中，处于数据链路层与运输层之间的是：网络层。
在OSI网络结构中，HTTP\\DHCP协议工作在：应用层。
在OSI中，物理层存在四个特性。其中，通信接口所用接线器的形状和尺寸属于：机械特性。
在数据链路层，数据的传送单位是帧。
在数字通信中广泛采用CRC循环冗余码的原因是CRC可以：.检测出多位突发性差错。
在TCP/IP体系结构模型中，下面哪项属于网络层协议，主要负责完成IP地址向物理地址转换的功能：.ARP协议。
在TCP/IP体系结构中，直接为ICMP提供服务的协议是：IP。
在TCP/IP协议簇中，TCP、UDP协议工作在：传输层。
在TCP/IP协议簇中，UDP协议工作在：传输层。
在TCP协议中，建立连接时需要将 字段中的 标志位置1：控制，SYN。
在网络边缘的端系统之间的通信方式通常可划分为客户/服务器方式或C/S方式和对等方式两大类。
在物理层接口特性中，用于描述完成每种功能的时间发生顺序的是：过程特性。
在网络核心部分起特殊作用的是路由器，是实现分组交换的关键构件，其任务是：.转发收到的分组。
子网掩码的作用是判断两台主机是否在同一子网中。
在下列功能中，哪一个最好地描述了OSI模型的数据链路层：保证数据正确的顺序、无错和完整。
在组建局域网时，"直通式"双绞线用到的是第1，2，3，6对线（顺序填序号，用"，"分隔）。
在专用网内部的一些主机已经分配到了本地IP地址，现在又想和互联网上的主机通讯，目前使用得最多的是1994年提出的方法NAT。
`,
        3: `【1】求：发送时延 + 传播时延
要算：发送时延ts(秒)=数据长度L(bit)/发送速率R(bit/s)；传播时延tp(秒)=距离d(m)/传播速率v(m/s)
元素捕捉： [距离d(km或m)] [传播速率v(m/s)] [数据长度L(bit或B/KB/MB)] [发送速率R(k/M/Gbit/s或bit/s)]
换算：L(B)→×8；L(KB)→×1024×8；L(MB)→×1024×1024×8；R(k)→×1000；R(M)→×10^6；R(G)→×10^9；d(km)→×1000
代入：ts=[L(bit)]/[R(bit/s)]=[ ]s；tp=[d(m)]/[v]=[ ]s
答案：发送时延=[ ]s；传播时延=[ ]s

------------------------------------------------------------
【2】求：两种情况发送/传播时延 + 结论
要算：情况1 ts1=L1/R1；情况2 ts2=L2/R2；两种 tp 都= d/v；再写结论句
元素捕捉： [公共：d(km或m)] [公共：v(m/s)] [情况1：L1] [情况1：R1] [情况2：L2] [情况2：R2]
换算：所有L/R/d按【1】统一单位
代入：ts1=L1/R1=[ ]s；tp1=d/v=[ ]s；ts2=L2/R2=[ ]s；tp2=d/v=[ ]s
结论（照抄）：发送时延只与数据长度/发送速率有关，与距离无关；传播时延只与距离/传播速率有关，与发送速率无关。

------------------------------------------------------------
【3】求：传播延迟=发送延迟 时的带宽（两问）
要算：先tp=d/v(秒)；令tp=ts=Pbit/R → R=Pbit/tp
元素捕捉： [链路长度d(km或m)] [传播速率v(m/s)] [分组长度P1(题干第1问)] [分组长度P2(题干第2问)]
换算：d(km)→m：×1000；Pbit=字节×8（若题干给bit就直接用bit）
代入：tp=[d(m)]/[v]=[ ]s
(1)P1bit=[P1(字节)]×8=[ ]bit → R1=P1bit/tp=[ ]bit/s（要Mb/s÷10^6，要Kb/s÷1000）
(2)P2bit=[P2(字节)]×8=[ ]bit → R2=P2bit/tp=[ ]bit/s（同上换单位）

------------------------------------------------------------
【4】求：TCP 传文件最后1bit到达时间（连续发 / 每包等RTT）
要算（照抄，不用懂TCP）：Tsend=Fbit/R；Tconn=2×RTT（或题目直接给）；Tprop_last=0.5×RTT
连续发送：Ttotal1=Tconn+Tsend+Tprop_last
每包等RTT：Ttotal2=Ttotal1+(N-1)×RTT，其中N=文件大小/分组大小
元素捕捉： [文件大小F(MB/KB/B)] [发送速率R(k/M/Gbit/s或bit/s)] [分组长度P(KB/B)] [RTT(ms或s)] [模式①/②]
换算：F→bit：MB×1024×1024×8；KB×1024×8；B×8；R到bit/s同【1】；RTT(ms)→s：/1000；P(KB)→B：×1024
代入：Tsend=[Fbit]/[R]=[ ]s；Tconn=2×[RTT(s)]=[ ]s（若题目已给Tconn直接填）；
     Tprop_last=0.5×[RTT(s)]=[ ]s；Ttotal1=[ ]s
若模式②：N=[文件大小(同单位)]/[分组长度(同单位)]=[ ]；Twait=(N-1)×RTT=[ ]s；Ttotal2=Ttotal1+Twait=[ ]s
答案：连续发送=[ ]s；每包等RTT=[ ]s

------------------------------------------------------------
【5】求：CDMA 解码（收到序列…）
要算：内积V=Σ(收到Ri×码片Si)（Σ表示"把每一项都加起来"）；解码D=V/N（N=码片长度）；D=1发"1"，D=-1发"0"，D=0未发
元素捕捉： [码片长度N(序列有几项就几)] [站A码片SA] [站B码片SB] [站C码片SC] [站D码片SD] [收到序列Rchip]
代入：VA=Σ(Rchip×SA)=[ ]（Σ：逐项相乘后相加）→（箭头表示"因此/下一步"）DA=VA/N=[ ] → 判定[ ]（判定填：1/0/未发）
     VB=Σ(Rchip×SB)=[ ] → DB=VB/N=[ ] → 判定[ ]（判定填：1/0/未发）
     VC=Σ(Rchip×SC)=[ ] → DC=VC/N=[ ] → 判定[ ]（判定填：1/0/未发）
     VD=Σ(Rchip×SD)=[ ] → DD=VD/N=[ ] → 判定[ ]（判定填：1/0/未发）

------------------------------------------------------------
【6】求：香农容量（W与dB）
要算：S/N=10^(dB/10)；C=W·log2（以2为底的对数）(1+S/N)
元素捕捉： [带宽W(Hz或kHz)] [信噪比dB]
换算：W若kHz→×1000；S/N=10^([dB]/10)
代入：C=[W(Hz)]×log2（以2为底的对数）(1+[S/N])=[ ]bit/s（要kb/s÷1000）

------------------------------------------------------------
【7】求：CDMA 解码（另一组收到序列）
同【5】（只替换成题目给的序列）

------------------------------------------------------------
【8】求：香农容量（另一组W与dB）
同【6】（只替换成题目给的W与dB）

------------------------------------------------------------
【9】求：CRC 检错（接收串÷生成多项式）
要做：接收串Rcv ÷ 生成多项式G（模2除法）→ 余数Rem；Rem=0无错，Rem≠0有错
元素捕捉： [生成多项式G(二进制串)] [接收比特串Rcv(题目给)]
代入：Rcv ÷ G（模2除法；÷表示"去除/相除"）→ Rem=[ ]
判定：Rem=0→无错；Rem≠0→有错

------------------------------------------------------------
【10】求：无噪声最大数据速率（W与每次采样bit）
要算：采样率fs=2W；最大速率Rmax=fs×b=2W×b
元素捕捉： [带宽W(Hz或kHz)] [每次采样b(bit/次)]
换算：W若kHz→×1000
代入：Rmax=2×[W(Hz)]×[b]=[ ]bit/s

------------------------------------------------------------
【11】求：奈奎斯特最大速率 + 香农最大速率
要算(1)奈奎斯特：k=log2（以2为底的对数）(物理状态数Nstate)；R_N=2W×k
要算(2)香农：S/N=10^(dB/10)；R_S=W·log2（以2为底的对数）(1+S/N)
元素捕捉： [带宽W(Hz或kHz)] [物理状态数Nstate] [信噪比dB]
换算：W若kHz→×1000；k=log2（以2为底的对数）(Nstate)；S/N=10^(dB/10)
代入：R_N=2×W×k=[ ]bit/s；R_S=W×log2（以2为底的对数）(1+S/N)=[ ]bit/s
答案：奈奎斯特=[ ]bit/s；香农=[ ]bit/s

------------------------------------------------------------
【12】求：CRC 余数（补0后模2除法取余）
要算：r=|G|-1；D0=D后补r个0；D0÷G取余数Rem
元素捕捉： [数据D(二进制串)] [生成多项式G(二进制串)] [G长度m=几位]
代入：r=m-1=[ ]；D0=D后补r个0=[ ]；D0 ÷ G（模2除法；÷表示"去除/相除"）→Rem=[ ]
答案：应添加余数=Rem=[ ]

============================================================
【13】求：把"总主机数T"平均分到"k个地点"（每地点地址块/前缀/最小最大IP）——已修正
你要做的事：先算"每地点约多少主机"，再给每地点一个"能装下(主机+2)"的地址块；最后列出k个地址块
元素捕捉： [母网地址块=129.250.0.0/16(题干给)] [总主机数T(题干给，如4000)] [地点数k(题干给，如16)]
① 平均每地点主机数：H = T / k = [ ]（主机）
② 每地点最少地址数（含网络+广播）：A = H + 2 = [ ]
③ 找最小2的幂：块大小B = 最小的2^h ≥ A = [ ]（地址数）→ h=[ ]
④ 每地点前缀：p = 32 - h = [ ]（例如/23）
⑤ 步长（决定"第几字节在递增"）——只按p套用：
   - 若 17≤p≤24：第三字节步长 step3 = 2^(24-p) = [ ]（/23→2，/22→4，/21→8 …）
   - 若 9≤p≤16：第二字节步长 step2 = 2^(16-p) = [ ]
⑥ 列出第i个地点地址块（i=1..k）（只填空）：
   - 网络地址（最小IP）= [129.250].[第三字节起点 + (i-1)×step3].0  （若步长在第二字节则改为第二字节递增）
   - 广播地址（最大IP）= 网络地址 + (B-1) = [ ]
答案壳：每地点前缀=/[p]；共列出k=[ ]个地址块，每块给出最小IP与最大IP。

------------------------------------------------------------
【14】求：等分子网（再分k个等大子网）
要算：借位sb满足2^sb=k；新前缀p1=p0+sb；每子网地址数=2^(32-p1)
元素捕捉： [原网络=136.23.12.64/26(题干给)] [要分k=4(题干给)]
代入：sb=[ ]（2^sb=k）；p1=p0+sb=26+[ ]=[ ]；每子网地址数=2^(32-p1)=[ ]
输出：子网掩码=/p1；每子网起始地址按"每子网地址数"递增列出。

------------------------------------------------------------
【15】求：等分子网（部门数k + 每部门主机H）
要算：2^h-2 ≥ H → 2^h ≥ H+2 → h；新前缀p1=32-h；可分子网数=2^(p1-p0) ≥ k
元素捕捉： [母网=199.1.1.0/24(题干给)] [部门数k] [每部门主机H]
代入：2^h ≥ H+2 → h=[ ]；p1=32-h=[ ]；可分子网数=2^(p1-24)=[ ]
输出：子网掩码=/p1；可分子网数=[ ]（应≥k）；每子网可用主机=2^h-2=[ ]（应≥H）
`,
        4: `【16】求：/24 子网划分（每子网≥H主机）+ 列子网表（含"是否禁用全0/全1"）——已修正
你要做的事：先算前缀与掩码；再按"步长"把每个子网号/主机范围/广播写出来（零基础照抄）
元素捕捉： [母网=192.168.215.0/24(题干给)] [每子网可用主机H(题干给，如30)] [是否禁用全0/全1子网(题干若提)]
① 先定前缀：
   A = H + 2 = [ ]（总地址需求）
   找最小2^h ≥ A → h=[ ]（主机位数）
   新前缀 p1 = 32 - h = [ ] ；掩码 = /p1 = [ ]（点分十进制）
② 块大小与步长：
   块大小B = 2^h = [ ]（地址数）
   对/24网：最后一字节步长 = B = [ ]，起点依次：0, B, 2B, 3B, ... , 255
③ 子网数量（按题干口径二选一）：
   - 若"禁用全0与全1子网"：可用子网数 = 2^(p1-24) - 2 = [ ]
   - 若"允许使用"：可用子网数 = 2^(p1-24) = [ ]
④ 列子网表（每个起点x一行；x取 0,B,2B,...；若禁用则跳过0与最后一个）：
   子网号：192.168.215.[x]
   可用主机范围：192.168.215.[x+1]  ~  192.168.215.[x+(B-2)]
   广播地址：192.168.215.[x+(B-1)]
（按题目要求列出规定数量的子网即可）

------------------------------------------------------------
【17】求：地址块最小/最大地址 + 掩码 + 地址数 + 等价C类数
要算：掩码；网络地址Amin(主机位全0)；广播Amax(主机位全1)；地址数2^(32-p)；等价C类=地址数/256
元素捕捉： [IP=140.120.84.24(题干给)] [前缀/p=20(题干给)]
代入：掩码=/20→[ ]；地址数=2^(32-20)=[ ]；等价C类=地址数/256=[ ]个
输出：Amin=[ ]；Amax=[ ]；掩码=[ ]；地址数=[ ]

------------------------------------------------------------
【18】求：VLSM（不同子网要N1/N2/N3个地址）按大到小分配
要做：需求从大到小；每个Ni找最小2^hi≥Ni；前缀pi=32-hi；按块大小顺延分配
元素捕捉： [母网=14.24.74.0/24(题干给)] [需求N1] [需求N2] [需求N3]
代入（每个子网一行）：
对Ni：2^hi≥[Ni]→hi=[ ]→pi=32-hi=[ ]→块大小=2^hi=[ ]
输出：从母网起始地址开始顺延：子网1最小=[ ]最大=[ ]；子网2最小=[ ]最大=[ ]；子网3最小=[ ]最大=[ ]

============================================================
【19】求：填表（类别/网络地址/广播/Host-ID/最大可用）——步长法（无脑）——已修正
你要做的事：先判断A/B/C类；再找到"掩码里不是255也不是0的那一段字节"，用"步长=256-掩码字节"分段定位网络/广播
元素捕捉： [IP地址 a.b.c.d(题干给)] [掩码 M1.M2.M3.M4(题干给) 或 /p]
① 类别（只看首字节a）：1~126→A；128~191→B；192~223→C
② 找"变化字节j"（掩码里第一个既≠255又≠0的字节）：
   step = 256 - Mj = [ ]（步长）
③ 用该字节定位分段：
   该字节的值 = IP的第j字节 = [ ]
   分段下界 = floor(值/step)×step（floor表示"向下取整"） = [ ]
   分段上界 = 下界 + step - 1 = [ ]
④ 网络地址（主机位全0）：
   把第j字节改成下界；后面的字节全写0 → Amin = [ ]
⑤ 广播地址（主机位全1）：
   把第j字节改成上界；后面的字节全写255 → Amax = [ ]
⑥ Host-ID（主机号）：
   第j字节Host = 原值 - 下界 = [ ]
   Host-ID = [前面网络部分为0].[第j字节Host].[后面原c.d照抄] = [ ]
⑦ 最大可用：
   Amax - 1 = [ ]（最后一字节减1即可）

------------------------------------------------------------
【20】求：转发表最长前缀匹配（逐个目的地址输出下一跳/接口）——已增强为无脑流程
你要做的事：对每个目的IP：逐条表项"算匹配"→ 在匹配中选"前缀最长(/位数最大)"→ 输出下一跳/接口
元素捕捉： [转发表每条：前缀/掩码/下一跳(题干给)] [目的地址D1..D5(题干给)]
无脑步骤（对每个目的地址Di都做一次）：
1) 对表中每条前缀 /p：
   - 把 /p 变成掩码（点分）→ [ ]
   - 计算 Di AND 掩码（AND=按位与） = [ ]（做法：四段分别做按位与；不会按位与就用计算器把每段转成二进制再与）
   - 若结果 == 该条前缀的网络号 → 记为"匹配"
2) 在所有"匹配"的条目里，选 /p 最大的那条（最长前缀）
3) 输出：Di = [ ] → 选中前缀 = [ ] → 下一跳/接口 = [ ]
（把这三步对 D1..D5 分别写出即可）

------------------------------------------------------------
【21】求：路由表最长前缀匹配（逐个目的地址输出下一跳/接口）——已增强为无脑流程
同【20】，只是目的地址数量不同；若题干给默认路由 0.0.0.0/0：全部不匹配时走默认
元素捕捉： [路由表各项(题干给)] [目的地址D1..D3(题干给)] [默认路由(若有)]
输出（每个目的地址一行）：Di=[ ] → 下一跳/接口=[ ]（若无匹配→默认）

============================================================
【22】求：IP分片（给UDP数据字段长度；求分片/偏移）
要算：每片最大数据Dmax=MTU-IP头；总数据Dtotal=UDP数据字段；分片；偏移offset=已发送数据字节/8
元素捕捉： [UDP数据字段=6500B(题干给)] [MTU=1500B] [IP头=20B]
代入：Dmax=1500-20=1480B；Dtotal=6500B
分片数：K=ceil(Dtotal/Dmax)（ceil表示"向上取整"）=[ ]（本例=5）
每片数据：前K-1片=1480B；最后一片=6500-1480×4=[ ]B（本例=580）
偏移：offset1=0；offset2=1480/8=[ ]；offset3=2960/8=[ ]；offset4=4440/8=[ ]；offset5=5920/8=[ ]
答案：共[ ]片；每片数据长度与偏移如上（若题目要"总长度"=IP头+该片数据）

------------------------------------------------------------
【23】求：IP分片（给UDP数据字段+UDP头；求分片/偏移）
要算：Dmax=MTU-IP头；Dtotal=UDP头+UDP数据字段；分片；偏移=已发送数据字节/8
元素捕捉： [UDP数据字段=8192B(题干给)] [UDP头=8B] [MTU=1500B] [IP头=20B]
代入：Dmax=1500-20=1480B；Dtotal=8192+8=8200B
分片数：K=ceil(Dtotal/Dmax)（ceil表示"向上取整"）=[ ]（本例=6）
每片数据：前K-1片=1480B；最后一片=8200-1480×5=[ ]B（本例=800）
偏移：offset1=0；offset2=1480/8=[ ]；offset3=2960/8=[ ]；offset4=4440/8=[ ]；offset5=5920/8=[ ]；offset6=7400/8=[ ]
答案：共[ ]片；每片数据长度与偏移如上`,

        5: `实验题
1.如图所示，某园区网用10Gbps的POS技术与Internet相连，POS接口的帧格式是SDH。园区网内部路由协议采用OSPF，园区网与Internet的连接使用静态路由协议。 
 
请阅读以下R3的部分配置信息，并补充空白处的配置命令或参数，按题目要求完成路由器的配置。
Router-R3#configure terminal
Router-R3(config)#interface pos3/0
Router-R3(config-if)#description To Internet
Router-R3(config-if)#bandwidth10000000
Router-R3(config-if)#ip address202.112.8.198 255.255.255.252
Router-R3(config-if)#crc32
Router-R3(config-if)#posframing sdhsdh
Router-R3(config-if)#no ip directed-broadcast
Router-R3(config-if)#pos flag s1s0 2
Router-R3(config-if)#no shutdown(打开端口)
Router-R3(configvif)#exit
Router-R3(config)#router ospf65
Router-R3(configvrouter)#network128.58.0.0 0.0.127.255area0
Router-R3(config-router)#redistribute connected metric-type 1 subnets
Router-R3(config-router)#area 0 range128.58.0.0255.255.128.0
Router-R3(config-router)#exit
Router-R3(config)#ip route 0.0.0.0 0.0.0.0 202.112.8.197
Router-R3(config)#exit
 

2.学校有新旧两个校区，每个校区是一个独立的局域网，为了使新旧校区能够正常相互通讯，共享资源。每个校区出口利用一台路由器进行连接，两台路由器间学校申请了一条2M的DDN专线进行相连，要求做适当配置实现两个校区的正常相互访问。 
 
计算机配置
PC1如下
IP:192.168.1.2
Submask:255.255.255.0
Gateway:192.168.1.1
PC2 如下
IP:192.168.2.2
Submask:255.255.255.0
Gateway:192.168.2.1
路由器配置
R1基本配置
（1）en//进入特权模式
（2）conf t//进入配置模式
（3）int fa 1/0//指定端口fa1/0
（4）no shutdown//激活端口
（5）ip address192.168.1.1255.255.255.0//配置IP地址和子网掩码
exit
serial2/0端口的基本信息如下：
IP地址192.168.3.1 255.255.255.0
（6）clock rate64000//配置时钟
end
R2基本配置
fa1/0IP地址与子网掩码192.168.2.1 255.255.255.0
serial2/0IP地址与子网掩码192.168.3.2 255.255.255.0
R1表静态路由表
（7）ip route192.168.2.0255.255.255.5192.168.3.2
end
 

3.作为某公司网络管理员，请你对新购路由器进行初始化配置，若希望以后在办公室或出差时也可以对设备进行远程管理，请在路由器上做适当配置。 
 ​​​​​​​
先连配置线（Console）：
假设PC已经完成如下配置：IP:192.168.1.2
Submask:255.255.255.0
Gageway:192.168.1.1；并进入PC终端。
（1）en//进入到特权模式；
（2）conf t//进入到配置模式；
（3）enable secret 123456//设置特权密码123456；
exit；
exit；
已经进入到特权模式，密码输入正确，在配置模式下：
（4）line vty 0 4//设置远程登陆的虚拟端口；
（5）password 5ijsj//设置telnet密码5ijsj；
（6）login//启用登录口令检查的命令；
exit；
（7）int fa 0/0//指定端口fa0/0；
（8）ip address 192.168.1.1 255.255.255.0//设置IP地址和子网掩码；
（9）no shut//激活端口；
end；
再连交叉线：
在PC的CMD模式下：
（10）telnet192.168.1.1//远程登录验证配置效果
 

4.某一公司内财务部、销售部的PC通过2台交换机实现通信，为了数据安全起见，要求销售部和财务部PC间通过VLAN进行互相隔离。请在如图所示的局域网中完成交换机S1的配置过程。 
 ​​​​​​​
交换机S1配置：
（1）en//进入特权模式；
（2）conf t//进入配置模式；
（3）vlan 2//建立VLAN2；
exit；
（4）vlan 3//建立VLAN3；
exit；
（5）int fa0/1//指定端口fa0/1；
（6）switch access vlan 2//把fa0/1加入到VLAN2；
exit；
（7）int fa 0/2//指定端口fa0/2；
（8）switch access vlan 3//把fa0/2加入到VLAN3；
exit；
（9）int fa 0/24//指定端口fa0/24；
（10）switch mode trunk//保证在跨越多个交换机上建立的同一个VLAN的成员能够相互通讯；
end
 

5.如图所示为用Windows2003Server配置WEB服务器实验中默认站点属性图，请参考此图实现WEB服务功能。 
 ​​​​​​​
（1）在Windows2003Server中"配置您的服务器向导"中，安装域控制器（AD）；
（2）在"控制面板-添加或删除程序"的"添加/删除Windows组件"的"应用程序服务器"中，
（3）选择安装IIS组件；//用于建立站点新建主页index.txt；
（4）c:\\inetpub\\wwwroot；//主页放置的默认主目录（填完整路径）
（5）在图中文档选项卡中添加主页"index.txt"；
（6）在"主目录"选项卡中设置该主页的最低权限为读取；在IE浏览器中输入IP地址即可浏览主页index.txt；
（7）打开DNS；//域名服务器，在此空写出其英文缩写
（8）在正向查找区域中中，//填正向或反向查找区域
（9）新建主机名为www并绑定IP地址（社会公认的名）；在IE浏览器中输入域名即可浏览主页index.txt；
（10）如A同学想通过在浏览器中输入域名的形式访问B同学的网站（主页），A同学需要在其网卡首选DNS修改为B同学的IP地址。
 

6.某单位的网络结构如图所示，请完成动态路由配置，实现两个不同网络的计算机PC0与PC1间的互相访问。 
 
已知计算机的配置如下：
PC0：IP地址:192.168.1.2子网掩码：255.255.255.0默认网关：192.168.1.1
PC1：IP地址:192.168.3.2子网掩码：255.255.255.0默认网关：192.168.3.1
请完善路由器的配置：
Route0端口配置：
Router>en
Router#conf t
route(config)#intfa 0/0//与PC0相连的端口
route(config-if)#ip ad192.168.1.2255.255.255.0
route(config-if)#no sh
Route(config-if)#ints 2/0//与Route1相连的端口
route(config-if)#ip ad 10.1.1.1 255.0.0.0
route(config-if)#no sh
Route1端口配置:
Router>en
Router#conft
route(config)#intf 0/0//与PC1相连的端口
route(config-if)#ip ad192.168.3.1255.255.255.0
route(config-if)#no sh
route(config-if)#ints 2/0//与Route0相连的端口
route(config-if)#ip ad 10.1.1.2 255.0.0.0
route(config-if)#no sh
Route0配置：
route(config)#route rip
route(config-router)#network192.168.1.0
route(config-router)#network10.1.1.0
route(config-router)#version 2
route(config-router)#exit
 

网络命令

7. 看下面两段命令，并回答问题。 
C:\\WINDOWS>ping www.baidu.com
Pinging www.a.shifen.com [211.94.144.100] with 32 bytes of data:
Reply from 211.94.144.100: bytes=32 time=39ms TTL=53
Reply from 211.94.144.100: bytes=32 time=39ms TTL=53
Reply from 211.94.144.100: bytes=32 time=39ms TTL=53
Reply from 211.94.144.100: bytes=32 time=39ms TTL=53
(…略)
C:\\WINDOWS>tracert www.baidu.com
Tracing route to www.a.shifen.com [211.94.144.100]
Over a maximum of 30 hops:

  1      4 ms       5 ms       4 ms      211.90.238.193
  2         <10 ms     <10 ms     <10 ms      61.241.76.113
  3       1 ms       1 ms       2 ms      61.241.76.17
  4        <10 ms     <10 ms     <10 ms      61.241.76.1
  5      1 ms     <10 ms       1 ms      211.94.44.73
  6      15 ms      14 ms      14 ms      211.94.40.237
  7      59 ms      59 ms      53 ms      211.94.56.5
  8      53 ms      53 ms      53 ms      211.94.44.2
  9      56 ms      56 ms      54 ms      211.94.68.110
 10      34 ms      33 ms      32 ms      211.94.68.126
 11      56 ms      58 ms      59 ms      211.94.144.2
 12      38 ms      39 ms      39 ms      211.94.144.100
Trace complete.

请回答下列6个问题：
（1）baidu网站的Web服务器的IP地址是什么？（3分）
（2）从上面的返回结果可以知道，采用Ping命令，向目的主机发出的探测数据包的数目为多少？每个探测数据包的大小为多少？（3分）
（3）tracert命令的主要功能是什么？（3分）
（4）通往baidu第一个网关的IP地址是多少？从上述命令中你能看出从WWW客户机到Baidu网站的Web服务器，途中经过几个网关？（4分）
（5） TTL是指什么？结合上述两个命令，你认为探测数据包的初始生存时间为多少？
（4分）
（6）在ping中为何会返回 www.a.shifen.com 这个域名？（3分）

参考答案： 
（1）211.94.144.100
（2）发包数目为4，每个包的大小为32字节
（3）Tracert进行路由跟踪，用于确定IP数据包访问目标所采取的路径，显示数据报经过的网关及到达的时间。
（4）第一个网关的IP地址是211.90.238.193，到Baidu服务器经过11个网关。
（5）TTL：(Time To Live )生存时间，数据包被路由器丢弃之前允许通过的网段数量。初始生存时间为64。
（6）www.a.shifen.com是baidu域名的一个别名，和www.baidu.com指向同一台主机。
`,
        6: `42. 叙述 IEEE802.3 以太网采用的介质访问控制协议的工作原理。 
 
参考答案： 
CSMA/CD 协议的工作原理是：
（1）某站点想发送数据时，必须首先侦听信道。
（2）如果信道空闲，立即发送数据并进行冲突检测；
（3）如果信道忙，继续侦听信道，直到信道变为空闲后才继续发送数据，并进行冲突检测。
（4）如果站点在发送数据过程中检测到冲突，它将立即停止发送数据并等待一个随机长的时间，重复上述过程 
43.某主机的IP地址是227.82.157.177/20。试问该主机所连接的网络前缀是什么？该网络的网络地址是什么？主机号占多少位？主机号的二进制表示是什么？ 
 
参考答案：
（1）网络前缀是：11100011010100101001，或用十进制表示为：227.82.144.0/20。
（2）网络地址是：11100011010100101001000000000000，或用十进制表示为：227.82.144.0。
（3）网络前缀是20位，所以主机号占12位。（4）主机号的二进制表示是：110110110001。 
44.有如下的4个/24地址块,试进行最大可能的聚合。212.56.132.0/24，212.56.133.0/24，212.56.134.0/24，212.56.135.0/24。 
 
参考答案：
由于四个地址块的前两个数字都相同，只需将每个地址块的第三个数字转换为二进制，如下：
212.56.100001 00.0，212.56.100001 01.0，212.56.100001 10.0，212.56.100001 11.0，
由于四个地址块中的前22位相同，所以聚合后地址块的网络前缀为 212.56.100001，所以聚合后的地址块为：212.56.10000100.00000000也即：212.56.132.0/22 
45.已知一IP地址为140.95.36.8，请回答以下问题。 
（1）如果该地址为分类IP，请计算该类地址中的最大网络数和每个网络中的最大主机数。
（2）如果要将该IP地址所属的网络划分为30个子网，请给出恰当的子网掩码。
（3）如果该地址为无类IP，请问在设计主机路由、点对点链路、默认路由时，网络前缀的长度分别是多少位？
 
参考答案：
（1）把140转换为二进制：10001100，因为其前两位是：10 ，因此 140.95.36.8是B类地址；B类地址可指派的网络数为2 14-1（128.0.0.0是不指派的），即16383；每个网络的最大主机数为2 16-2（主机位全1或全0特殊用途），即65534；
（2）如果要将该IP地址所属的网络划分为30个子网，则需将主机号中的前5位（2 5=32）拿出来作为子网号。由于该IP地址为B类地址，所以其子网掩码为：11111111.11111111.11111000.00000000，则得出子网掩码为:255.255.248.0；
（3）32、31、0位 
46. 一台计算机的 IP 地址和子网掩码 172.16.2.160/26 ，如何计算出该计算机所在的子网地址、子网广播地址、该子网中第一个可用的 IP 地址、该子网中最后一个可用的 IP 地址，该子网中共有多少个 IP 地址可用？ 
 
参考答案： 
基于给定的 IP 地址172.16.2.160和前缀长度/26（子网掩码前 26 位为 1），步骤如下：
（1）. 确定子网掩码
前缀长度/26表示子网掩码前 26 位为 "1"，后 6 位为 "0"，转换为点分十进制：
255.255.255.192（二进制：11111111.11111111.11111111.11000000）
（2）. 计算子网地址（网络地址）
子网地址是 IP 地址与子网掩码进行 "与运算" 的结果（保留掩码中 "1" 对应的 IP 位，"0" 对应位清零）：
IP 地址172.16.2.160的二进制（仅关注第 4 个字节，前 3 个字节固定）：
第 4 个字节160 → 二进制10100000
子网掩码第 4 个字节192 → 二进制11000000
与运算结果：10100000 & 11000000 = 10000000（即 128）
因此，子网地址为 172.16.2.128。
（3）. 计算子网广播地址
广播地址是子网地址中，掩码 "0" 对应的位全置为 1 的结果：
子网地址第 4 个字节为128（二进制10000000）
掩码后 6 位为 0，因此广播地址第 4 个字节为10111111（即 191）
因此，子网广播地址为 172.16.2.191。
（4）. 第一个可用 IP 地址
子网中第一个可用 IP 是子网地址加 1：
172.16.2.128 + 1 = 172.16.2.129
（5）. 最后一个可用 IP 地址
子网中最后一个可用 IP 是广播地址减 1：
172.16.2.191 - 1 = 172.16.2.190
（6）. 子网可用 IP 地址数量
总地址数 =2(32-26) = 64个（包含子网地址和广播地址）。
可用地址数 = 总地址数 - 2（排除子网地址和广播地址） = 62 个。
综上：
子网地址：172.16.2.128
子网广播地址：172.16.2.191
第一个可用 IP地址：172.16.2.129
最后一个可用 IP地址：172.16.2.190
可用 IP 地址数量：62 个

18. 域名系统的主要功能是什么？简单叙述访问站点 www.lui.edu.cn 的过程中， DNS 的域名解析过程。（设 www.lui.edu.cn 的 IP 地址为： 202.101.208.10,DNS 地址 : 202.101.208.3 ） 
 
参考答案： 
域名系统的主要功能是将域名解析为相应的IP地址。
访问www.lui.edu.cn的域名解析过程：
（1）在浏览器地址栏输入地址www.lui.edu.cn；　
（2）先在本机域名解析的缓存中查找该域名，若找到则可以立即获取对应的IP地址；
（3）若不在本机缓存中则向本地DNS 服务器 （202.101.208.3）发送DNS请求报文，请求解析该域名。
（4）DNS收到请求后查找自己的缓存及其映射表，若查到则发送响应报文给发送请求的主机，若没有找到则向上级DNS服务器提出请求，直到解析成功或返回错误信息。

19.下面是以十六进制格式存储的一个UDP首部：CB84000D001C001C 
试问：
（1）源端口号是什么？
（2）目的端口号是什么？
（3）这个用户数据报的总长度是多少？
（4）数据的长度是多少？
（5）这个分组是从客户到服务器方向的，还是从服务器到客户方向的？
 
参考答案：（1）52100（2）13（3）28字节（4）20字节（4）分组是从客户到服务器 

`,
        7: `预设7内容 - 请在此处粘贴你的内容`,
        8: `预设8内容 - 请在此处粘贴你的内容`,
        9: `预设9内容 - 请在此处粘贴你的内容`
    };

    // 复制预设内容
    function copyPreset(num) {
        const content = presetContents[num];
        if (content) {
            const name = presetNames[num] || `预设${num}`;
            navigator.clipboard.writeText(content)
                .then(() => showStatus(`${name}已复制`))
                .catch(() => showStatus('复制失败', true));
        } else {
            showStatus(`预设${num}未找到`, true);
        }
    }

    // ========== 8. 初始化 ==========
    function init() {
        console.log('[助手] 初始化开始');
        createStatusPanel();
        setupKeyboardShortcuts();
        
        setTimeout(() => {
            document.querySelectorAll('iframe').forEach(iframe => {
                try {
                    const doc = iframe.contentDocument;
                    if (doc) doc.addEventListener('keydown', handleKeydown, true);
                } catch (e) {}
            });
        }, 1000);
        
        console.log('[助手] 初始化完成，预设快捷键 Alt+1~9 可用');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ========== 9. 与popup/background通信 ==========
    if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (!request?.action) return false;
            
            switch (request.action) {
                case 'toggle':
                    isEnabled = request.enabled;
                    showStatus(isEnabled ? '已开启' : '已关闭');
                    break;
                case 'copy':
                    if (isEnabled) stealthCopy();
                    break;
                case 'paste':
                    if (isEnabled) stealthPaste();
                    break;
                case 'enableSelect':
                    lightUnlock();
                    handleIframes();
                    showStatus('已解锁');
                    break;
                case 'copyPreset':
                    if (isEnabled && request.preset) copyPreset(request.preset);
                    break;
                case 'getStatus':
                    sendResponse({ enabled: isEnabled, loaded: true });
                    return true;
            }
            return false;
        });

        chrome.runtime.sendMessage({ action: 'getStatus' }, response => {
            if (chrome.runtime.lastError) return;
            if (response?.enabled !== undefined) {
                isEnabled = response.enabled;
            }
        });
    }
})();
