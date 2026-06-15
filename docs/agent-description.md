# Mô tả Agent: Claw-a-thon Browser Agent

## Agent giải quyết vấn đề gì?

Người dùng thường mất nhiều thời gian thực hiện các tác vụ lặp đi lặp lại trên trình duyệt — điền form, tổng hợp thông tin từ nhiều tab, giám sát trang web, hay điều hướng qua nhiều bước. Các công cụ tự động hóa hiện tại đòi hỏi kỹ thuật cao hoặc chỉ xử lý được kịch bản cố định.

**Claw-a-thon Browser Agent** giải quyết vấn đề này bằng cách biến trình duyệt Chrome thành một AI agent có thể nhận lệnh bằng ngôn ngữ tự nhiên và tự thực hiện các tác vụ trên trình duyệt.

## Ai là người sử dụng?

- **Người dùng cuối không có kỹ thuật** muốn tự động hóa tác vụ trình duyệt hằng ngày mà không cần viết code.
- **Developer / QA** cần kiểm thử giao diện hoặc thu thập dữ liệu nhanh.
- **Nhân viên văn phòng** xử lý lặp lại nhiều trang nội bộ, hệ thống ERP, hoặc công cụ web của doanh nghiệp.

## Agent hoạt động như thế nào?

Người dùng nhập yêu cầu bằng ngôn ngữ tự nhiên vào side panel của extension. Agent nhận yêu cầu, suy luận chuỗi hành động cần thực hiện, rồi gọi các browser tool (~75 công cụ) để tương tác trực tiếp với trình duyệt — điều hướng, click, điền form, chụp màn hình, đọc nội dung trang, quản lý tab và bookmark. Kết quả từ mỗi bước được đưa trở lại model để quyết định bước tiếp theo, tạo thành vòng lặp agent cho đến khi hoàn thành.

Hệ thống gồm ba thành phần:

- **Chrome Extension** — giao diện chat + cầu nối giữa LLM và trình duyệt
- **agent-service** — backend LLM orchestration (Anthropic, OpenAI, hoặc bất kỳ provider OpenAI-compatible)
- **native-server** — MCP gateway xác thực và relay tool calls từ LLM về extension

## Giá trị mang lại

- **Tiết kiệm thời gian** — tác vụ nhiều bước thực hiện trong vài giây thay vì vài phút.
- **Không cần kỹ năng kỹ thuật** — chỉ cần mô tả bằng tiếng Việt hoặc tiếng Anh.
- **Linh hoạt với mọi trang web** — không cần cài thêm adapter hay script riêng cho từng website.
- **Tích hợp LLM tùy chọn** — dùng được với Anthropic, OpenAI, VNGCloud AI Platform, hay bất kỳ provider nào hỗ trợ OpenAI API format.
