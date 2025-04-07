const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs-extra');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

// URL Wikipedia
const WIKI_URL = 'https://vi.wikipedia.org/wiki/Di_t%C3%ADch_qu%E1%BB%91c_gia_%C4%91%E1%BA%B7c_bi%E1%BB%87t_(Vi%E1%BB%87t_Nam)';

// Đường dẫn output
const OUTPUT_DIR = path.join(__dirname, 'data', 'raw');
const JSON_OUTPUT = path.join(OUTPUT_DIR, 'vietnam-heritage-sites.json');
const CSV_OUTPUT = path.join(OUTPUT_DIR, 'vietnam-heritage-sites.csv');
const FILTERED_JSON_OUTPUT = path.join(OUTPUT_DIR, 'vietnam-heritage-sites-filtered.json');
const FILTERED_CSV_OUTPUT = path.join(OUTPUT_DIR, 'vietnam-heritage-sites-filtered.csv');

// Tạo thư mục output nếu chưa tồn tại
fs.ensureDirSync(OUTPUT_DIR);

// Hàm làm sạch văn bản
function cleanString(str) {
    if (!str) return '';

    // Loại bỏ xuống dòng và làm sạch
    let cleaned = str.replace(/\n/g, " ")  // Thay \n bằng khoảng trắng
        .replace(/\[\d+\]/g, "")    // Xóa [số]
        .replace(/\s+/g, " ")       // Thay nhiều khoảng trắng liên tiếp bằng một khoảng trắng
        .trim();                    // Xóa khoảng trắng đầu/cuối

    // Xóa khoảng trắng sau dấu chấm, dấu phẩy, dấu chấm phẩy, dấu hai chấm
    cleaned = cleaned.replace(/\.\s+/g, ".");
    cleaned = cleaned.replace(/,\s+/g, ",");
    cleaned = cleaned.replace(/;\s+/g, ";");
    cleaned = cleaned.replace(/:\s+/g, ":");

    return cleaned;
}

// Hàm xử lý tọa độ
function extractCoordinates(text) {
    if (!text) return null;

    // Thử các định dạng tọa độ khác nhau
    // Định dạng 1: 21,0307°B 105,852°Đ
    const regex1 = /(\d+[.,]\d+)°([BN])[\s,]+(\d+[.,]\d+)°([ĐE])/;

    // Định dạng 2: 10°46′37″B 106°41′43″Đ
    const regex2 = /(\d+)°(\d+)′(\d+)″([BN])\s+(\d+)°(\d+)′(\d+)″([ĐE])/;

    // Kiểm tra định dạng 1
    const match1 = text.match(regex1);
    if (match1) {
        const lat = match1[1].replace(',', '.');
        const lng = match1[3].replace(',', '.');

        return {
            latitude: `${lat}°${match1[2]}`,
            longitude: `${lng}°${match1[4]}`
        };
    }

    // Kiểm tra định dạng 2
    const match2 = text.match(regex2);
    if (match2) {
        return {
            latitude: `${match2[1]}°${match2[2]}′${match2[3]}″${match2[4]}`,
            longitude: `${match2[5]}°${match2[6]}′${match2[7]}″${match2[8]}`
        };
    }

    return null;
}

async function crawlHeritages() {
    console.log('Bắt đầu cào dữ liệu di tích quốc gia đặc biệt...');

    // Cấu hình options cho Chrome
    const options = new chrome.Options();
    options.addArguments('--headless'); // Chạy ẩn không hiển thị giao diện
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');

    // Khởi tạo WebDriver
    const driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

    try {
        // Truy cập trang Wikipedia
        console.log(`Đang truy cập ${WIKI_URL}...`);
        await driver.get(WIKI_URL);
        await driver.wait(until.elementLocated(By.css('table.wikitable')), 10000);

        // Mảng lưu trữ dữ liệu di tích
        const heritages = [];

        // Lấy tất cả các bảng
        const tables = await driver.findElements(By.css('table.wikitable.sortable.jquery-tablesorter'));
        console.log(`Đã tìm thấy ${tables.length} bảng.`);

        // Duyệt qua từng bảng
        for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
            const table = tables[tableIndex];

            // Lấy tiêu đề của bảng 
            let tableCaption = '';
            try {
                //tableCaption = await table.findElement(By.css('caption')).getText();
                console.log(`\nĐang xử lý bảng: ${tableIndex + 1}`);
            } catch (error) {
                console.log(`\nĐang xử lý bảng không có tiêu đề`);
            }

            // Lấy các hàng dữ liệu (bỏ qua hàng tiêu đề)
            const rows = await table.findElements(By.css('tr'));

            // Duyệt qua từng hàng, bỏ qua hàng đầu tiên (tiêu đề)
            for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
                const row = rows[rowIndex];
                const cells = await row.findElements(By.css('td'));

                if (cells.length >= 3) {
                    // Trích xuất thông tin từ các cột
                    const nameCell = cells[0];
                    const imageCell = cells[1];
                    const locationCell = cells[2];
                    const typesCell = cells[3];

                    const name = cleanString(await nameCell.getText());
                    const locationText = await locationCell.getText();

                    // Tách riêng địa điểm và tọa độ
                    const coordinates = extractCoordinates(locationText);
                    let location = locationText;

                    // Nếu có tọa độ, loại bỏ phần tọa độ khỏi location
                    if (coordinates) {
                        // Tìm vị trí của tọa độ trong chuỗi location
                        const regex1 = /\d+[.,]\d+°[BN][\s,]+\d+[.,]\d+°[ĐE]/;
                        const regex2 = /\d+°\d+′\d+″[BN]\s+\d+°\d+′\d+″[ĐE]/;

                        const match1 = location.match(regex1);
                        const match2 = location.match(regex2);

                        if (match1) {
                            location = location.replace(match1[0], '').trim();
                        } else if (match2) {
                            location = location.replace(match2[0], '').trim();
                        }
                    }

                    // Làm sạch location
                    location = cleanString(location);
                    const types = cleanString(await typesCell.getText());

                    // Lấy hình ảnh
                    let imageUrl = '';
                    try {
                        const img = await imageCell.findElement(By.css('img')); // Tìm thẻ <img> trong imageCell
                        imageUrl = await img.getAttribute('src'); // Lấy giá trị của thuộc tính 'src'

                        // Nếu link không có "http", thêm "https:" vào
                        if (imageUrl && !imageUrl.startsWith('http')) {
                            imageUrl = 'https:' + imageUrl;
                        }
                    } catch (error) {
                        console.log('Không tìm thấy ảnh');
                    }

                    // Lấy link chi tiết
                    let detailLink = '';
                    try {
                        detailLink = await nameCell.findElement(By.css('a')).getAttribute('href');
                    } catch (error) {
                        // Không có link
                    }

                    // Thêm vào mảng di tích
                    if (name) {
                        heritages.push({
                            name,
                            location,
                            coordinates,
                            types,
                            detailLink,
                            imageUrl,
                            description: '',
                            events: [],
                            architectural: '',
                            culturalFestival: ''
                        });

                        console.log(`  - Đã thêm: ${name}`);
                    }
                }
            }
        }

        console.log(`\nĐã cào được ${heritages.length} di tích. Đang lấy thông tin chi tiết...`);

        // Lấy thông tin chi tiết cho từng di tích
        for (let i = 0; i < heritages.length; i++) {
            const heritage = heritages[i];

            if (heritage.detailLink) {
                try {
                    console.log(`\nĐang lấy thông tin chi tiết cho: ${heritage.name} (${i + 1}/${heritages.length})`);

                    // Truy cập trang chi tiết
                    await driver.get(heritage.detailLink);
                    await driver.wait(until.elementLocated(By.css('#mw-content-text')), 10000);

                    // Lấy đoạn mô tả đầu tiên
                    try {
                        const firstParagraph = await driver.findElement(By.css('#mw-content-text p'));
                        heritage.description = cleanString(await firstParagraph.getText());
                        console.log('  - Đã lấy mô tả');
                    } catch (error) {
                        console.log('  - Không tìm thấy mô tả');
                    }

                    // Lấy tất cả thẻ h2 trong trang
                    const allH2 = await driver.executeScript(`
                        return Array.from(document.querySelectorAll('h2')).map(h2 => ({
                            text: h2.textContent.trim(),
                            element: h2
                        }));
                    `);

                    // PHẦN 1: Tìm h2 chứa từ khóa "lịch sử" hoặc tương tự
                    try {
                        const historyH2 = await driver.executeScript(`
                            const h2s = arguments[0];
                            return h2s.find(item => 
                                item.text.toLowerCase().includes('lịch sử') ||
                                item.text.toLowerCase().includes('phát triển') ||
                                item.text.toLowerCase().includes('hình thành')
                            );
                        `, allH2);

                        if (historyH2) {
                            console.log('  - Đã tìm thấy phần lịch sử');

                            // Xử lý phần lịch sử
                            const historyContent = await driver.executeScript(`
                                const h2 = arguments[0].element;
                                const heritageName = arguments[1];
                                const events = [];
                                
                                // Tìm thẻ div chứa h2
                                const h2Div = h2.closest('div.mw-heading');
                                if (!h2Div) return events;
                                
                                // Tìm tất cả h3 sau h2 này
                                let currentElement = h2Div.nextElementSibling;
                                const h3Elements = [];
                                
                                // Chuẩn bị tìm h3 elements và các nội dung sau mỗi h3
                                while (currentElement && 
                                      !currentElement.querySelector('h2') && 
                                      !currentElement.classList.contains('mw-heading-2')) {
                                    
                                    if (currentElement.classList.contains('mw-heading') && 
                                        currentElement.querySelector('h3')) {
                                        h3Elements.push({
                                            element: currentElement,
                                            title: currentElement.querySelector('h3').textContent.trim()
                                        });
                                    }
                                    
                                    currentElement = currentElement.nextElementSibling;
                                }
                                
                                // Nếu có các h3, xử lý từng h3
                                if (h3Elements.length > 0) {
                                    for (let i = 0; i < h3Elements.length; i++) {
                                        const h3Data = h3Elements[i];
                                        const nextH3 = h3Elements[i + 1]?.element;
                                        let description = '';
                                        
                                        // Lấy tất cả các thẻ p giữa h3 hiện tại và h3 tiếp theo
                                        let element = h3Data.element.nextElementSibling;
                                        
                                        while (element && element !== nextH3 && 
                                              !element.querySelector('h2') && 
                                              !element.classList.contains('mw-heading-2')) {
                                            
                                            if (element.tagName === 'P') {
                                                description += element.textContent.trim() + ' ';
                                            }
                                            
                                            element = element.nextElementSibling;
                                        }
                                        
                                        events.push({
                                            title: h3Data.title,
                                            description: description.trim()
                                        });
                                    }
                                } 
                                // Không có h3, lấy tất cả p sau h2
                                else {
                                    let description = '';
                                    let element = h2Div.nextElementSibling;
                                    
                                    while (element && 
                                          !element.querySelector('h2') && 
                                          !element.classList.contains('mw-heading-2')) {
                                        
                                        if (element.tagName === 'P') {
                                            description += element.textContent.trim() + ' ';
                                        }
                                        
                                        element = element.nextElementSibling;
                                    }
                                    
                                    if (description.trim()) {
                                        events.push({
                                            title: "Lịch sử " + heritageName,
                                            description: description.trim()
                                        });
                                    }
                                }
                                
                                return events;
                            `, historyH2, heritage.name);

                            if (historyContent && historyContent.length > 0) {
                                heritage.events = historyContent.map(event => ({
                                    title: event.title,
                                    description: cleanString(event.description)
                                }));
                                console.log(`  - Đã lấy ${historyContent.length} sự kiện lịch sử`);
                            } else {
                                console.log('  - Không tìm thấy sự kiện lịch sử');
                            }
                        } else {
                            console.log('  - Không tìm thấy phần lịch sử');
                        }

                        // PHẦN 2: Tìm h2 chứa từ khóa "kiến trúc"
                        const architectureH2 = await driver.executeScript(`
                            const h2s = arguments[0];
                            return h2s.find(item => 
                                item.text.toLowerCase().includes('kiến trúc') ||
                                item.text.toLowerCase().includes('công trình') ||
                                item.text.toLowerCase().includes('di tích')
                            );
                        `, allH2);

                        if (architectureH2) {
                            console.log('  - Đã tìm thấy phần kiến trúc');

                            // Lấy tất cả văn bản trong phần kiến trúc
                            const architectureContent = await driver.executeScript(`
                                const h2 = arguments[0].element;
                                const h2Div = h2.closest('div.mw-heading');
                                if (!h2Div) return '';
                                
                                let content = '';
                                let element = h2Div.nextElementSibling;
                                
                                while (element && 
                                      !element.querySelector('h2') && 
                                      !element.classList.contains('mw-heading-2')) {
                                    
                                    if (element.tagName === 'P') {
                                        content += element.textContent.trim() + ' ';
                                    }
                                    
                                    element = element.nextElementSibling;
                                }
                                
                                return content.trim();
                            `, architectureH2);

                            if (architectureContent) {
                                heritage.architectural = cleanString(architectureContent);
                                console.log('  - Đã lấy thông tin kiến trúc');
                            }
                        } else {
                            console.log('  - Không tìm thấy phần kiến trúc');
                        }

                        // PHẦN 3: Tìm h2 chứa từ khóa "lễ hội"
                        const festivalH2 = await driver.executeScript(`
                            const h2s = arguments[0];
                            return h2s.find(item => 
                                item.text.toLowerCase().includes('lễ hội') ||
                                item.text.toLowerCase().includes('nghi lễ') ||
                                item.text.toLowerCase().includes('phong tục') ||
                                item.text.toLowerCase().includes('tín ngưỡng')
                            );
                        `, allH2);

                        if (festivalH2) {
                            console.log('  - Đã tìm thấy phần lễ hội/nghi lễ');

                            // Lấy tất cả văn bản trong phần lễ hội
                            const festivalContent = await driver.executeScript(`
                                const h2 = arguments[0].element;
                                const h2Div = h2.closest('div.mw-heading');
                                if (!h2Div) return '';
                                
                                let content = '';
                                let element = h2Div.nextElementSibling;
                                
                                while (element && 
                                      !element.querySelector('h2') && 
                                      !element.classList.contains('mw-heading-2')) {
                                    
                                    if (element.tagName === 'P') {
                                        content += element.textContent.trim() + ' ';
                                    }
                                    
                                    element = element.nextElementSibling;
                                }
                                
                                return content.trim();
                            `, festivalH2);

                            if (festivalContent) {
                                heritage.culturalFestival = cleanString(festivalContent);
                                console.log('  - Đã lấy thông tin lễ hội/nghi lễ');
                            }
                        } else {
                            console.log('  - Không tìm thấy phần lễ hội/nghi lễ');
                        }

                    } catch (error) {
                        console.log('  - Lỗi khi lấy phần lịch sử:', error.message);
                    }

                    // Tạm dừng để tránh quá tải server
                    await driver.sleep(1000);

                } catch (error) {
                    console.error(`  - Lỗi khi lấy chi tiết cho ${heritage.name}:`, error.message);
                }
            }
        }

        // Lọc mảng heritages để loại bỏ các phần tử không có tọa độ và không phải di tích lịch sử
        const filteredHeritages = heritages.filter(heritage => {
            // Kiểm tra xem có tọa độ không
            const hasCoordinates = heritage.coordinates !== null;

            // Kiểm tra xem có phải di tích lịch sử không
            const isHistoricalSite = heritage.types.includes('Di tích lịch sử');

            // Chỉ giữ lại những di tích có cả tọa độ và là di tích lịch sử
            return hasCoordinates && isHistoricalSite;
        });

        console.log(`Đã lọc còn ${filteredHeritages.length}/${heritages.length} di tích có tọa độ và thuộc di tích lịch sử.`);

        // Lưu dữ liệu gốc và dữ liệu đã lọc
        await fs.writeJson(JSON_OUTPUT, heritages, { spaces: 2 });
        console.log(`\nĐã lưu dữ liệu gốc vào file JSON: ${JSON_OUTPUT}`);

        await fs.writeJson(FILTERED_JSON_OUTPUT, filteredHeritages, { spaces: 2 });
        console.log(`Đã lưu dữ liệu đã lọc vào file JSON: ${FILTERED_JSON_OUTPUT}`);

        // Lưu dữ liệu gốc vào CSV
        const csvWriter = createObjectCsvWriter({
            path: CSV_OUTPUT,
            header: [
                { id: 'name', title: 'Tên di tích' },
                { id: 'location', title: 'Địa điểm' },
                { id: 'types', title: 'Loại di tích' },
                { id: 'imageUrl', title: 'Đường dẫn hình ảnh' },
                { id: 'description', title: 'Mô tả' }
            ],
            encoding: 'utf8'
        });

        await csvWriter.writeRecords(heritages);
        console.log(`Đã lưu dữ liệu gốc vào file CSV: ${CSV_OUTPUT}`);

        // Lưu dữ liệu đã lọc vào CSV
        const filteredCsvWriter = createObjectCsvWriter({
            path: FILTERED_CSV_OUTPUT,
            header: [
                { id: 'name', title: 'Tên di tích' },
                { id: 'location', title: 'Địa điểm' },
                { id: 'types', title: 'Loại di tích' },
                { id: 'imageUrl', title: 'Đường dẫn hình ảnh' },
                { id: 'description', title: 'Mô tả' }
            ],
            encoding: 'utf8'
        });

        await filteredCsvWriter.writeRecords(filteredHeritages);
        console.log(`Đã lưu dữ liệu đã lọc vào file CSV: ${FILTERED_CSV_OUTPUT}`);

        return { all: heritages, filtered: filteredHeritages };

    } catch (error) {
        console.error('Lỗi trong quá trình cào dữ liệu:', error);
        throw error;
    } finally {
        await driver.quit();
        console.log('Đã đóng trình duyệt');
    }
}

// Chạy crawler
crawlHeritages()
    .then(result => {
        console.log(`Hoàn tất quá trình cào dữ liệu!`);
        console.log(`Tổng số di tích: ${result.all.length}`);
        console.log(`Số di tích sau khi lọc: ${result.filtered.length}`);
    })
    .catch(error => {
        console.error('Lỗi khi chạy crawler:', error);
    });