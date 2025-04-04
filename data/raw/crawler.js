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

// Tạo thư mục output nếu chưa tồn tại
fs.ensureDirSync(OUTPUT_DIR);

function cleanString(str) {
    return str.replace(/\n/g, " ")  // Thay \n bằng khoảng trắng
        .replace(/\[\d+\]/g, ""); // Xóa [số] 
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

            // Xác định loại di tích từ tiêu đề
            // let heritageType = 'Chưa phân loại';
            // if (tableCaption.toLowerCase().includes('lịch sử')) {
            //     heritageType = 'Di tích lịch sử';
            // } else if (tableCaption.toLowerCase().includes('kiến trúc')) {
            //     heritageType = 'Di tích kiến trúc nghệ thuật';
            // } else if (tableCaption.toLowerCase().includes('khảo cổ')) {
            //     heritageType = 'Di tích khảo cổ';
            // } else if (tableCaption.toLowerCase().includes('danh lam')) {
            //     heritageType = 'Danh lam thắng cảnh';
            // }

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
                    //const image = await imageCell.getText();
                    const location = await locationCell.getText();
                    const types = await typesCell.getText();
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
                            types,
                            detailLink,
                            imageUrl,
                            description: '',
                            events: []
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
                        heritage.description = await firstParagraph.getText();
                        console.log('  - Đã lấy mô tả');
                    } catch (error) {
                        console.log('  - Không tìm thấy mô tả');
                    }

                    // Tìm tiêu đề lịch sử
                    try {
                        // Tìm tất cả các tiêu đề h2 có chứa từ "lịch sử" hoặc tương tự
                        const historyH2 = await driver.executeScript(`
                            const h2Elements = Array.from(document.querySelectorAll('h2'));
                            return h2Elements.find(el => 
                                el.textContent.toLowerCase().includes('lịch sử')
                            );
                        `);

                        if (historyH2) {
                            console.log('  - Đã tìm thấy phần lịch sử');

                            // Tìm tất cả các h3 và p sau h2 này cho đến h2 tiếp theo
                            const historyContent = await driver.executeScript(`
                                const h2 = arguments[0];
                                const div = h2.closest('div.mw-heading');
                                if (!div) return null;
                                
                                const events = [];
                                let currentEvent = null;
                                let currentDescription = '';
                                
                                // Lấy tất cả các elements sau div chứa h2 này
                                let currentElement = div.nextElementSibling;
                                
                                while (currentElement && 
                                      !currentElement.querySelector('h2') && 
                                      !currentElement.classList.contains('mw-heading-2')) {
                                    
                                    // Nếu là h3 thì bắt đầu một event mới
                                    if (currentElement.classList.contains('mw-heading') && 
                                        currentElement.querySelector('h3')) {
                                        
                                        // Lưu event cũ nếu có
                                        if (currentEvent) {
                                            currentEvent.description = currentDescription.trim();
                                            events.push(currentEvent);
                                            currentDescription = '';
                                        }
                                        
                                        // Tạo event mới
                                        const h3 = currentElement.querySelector('h3');
                                        currentEvent = {
                                            title: h3.textContent.trim(),
                                            description: ''
                                        };
                                    }
                                    // Nếu là p và đã có event thì thêm vào description
                                    else if (currentElement.tagName === 'P' && currentEvent) {
                                        currentDescription += currentElement.textContent + '\\n';
                                    }
                                    // Nếu là p nhưng chưa có event (trước h3 đầu tiên)
                                    else if (currentElement.tagName === 'P' && !currentEvent) {
                                        // Có thể đây là đoạn mở đầu, thêm vào mô tả chung
                                    }
                                    
                                    currentElement = currentElement.nextElementSibling;
                                }
                                
                                // Lưu event cuối cùng nếu có
                                if (currentEvent) {
                                    currentEvent.description = currentDescription.trim();
                                    events.push(currentEvent);
                                }
                                
                                return events;
                            `, historyH2);

                            if (historyContent && historyContent.length > 0) {
                                heritage.events = historyContent;
                                console.log(`  - Đã lấy ${historyContent.length} sự kiện lịch sử`);
                            } else {
                                console.log('  - Không tìm thấy cấu trúc sự kiện lịch sử theo dạng h3->p');
                            }
                        } else {
                            console.log('  - Không tìm thấy phần lịch sử');
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

        // Lưu dữ liệu vào file JSON
        await fs.writeJson(JSON_OUTPUT, heritages, { spaces: 2 });
        console.log(`\nĐã lưu dữ liệu vào file JSON: ${JSON_OUTPUT}`);

        // Lưu dữ liệu vào file CSV
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
        console.log(`Đã lưu dữ liệu vào file CSV: ${CSV_OUTPUT}`);

        return heritages;

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
    .then(() => {
        console.log('Hoàn tất quá trình cào dữ liệu!');
    })
    .catch(error => {
        console.error('Lỗi khi chạy crawler:', error);
    });