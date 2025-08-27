// Sipariş modal fonksiyonları
async function openOrderModal() {
    try {
        // Müşterileri yükle
        const customersResponse = await apiCall('/api/customers');
        const customers = customersResponse.customers || [];
        const customerSelect = document.getElementById('order_customer_id');
        customerSelect.innerHTML = '<option value="">Müşteri Seçiniz</option>';
        customers.forEach(customer => {
            customerSelect.innerHTML += `<option value="${customer.id}">${customer.company_name}</option>`;
        });

        // Satış temsilcilerini yükle
        const usersResponse = await apiCall('/api/users');
        const users = usersResponse.users || [];
        const salesRepSelect = document.getElementById('order_sales_rep_id');
        salesRepSelect.innerHTML = '<option value="">Temsilci Seçiniz</option>';
        users.forEach(user => {
            salesRepSelect.innerHTML += `<option value="${user.id}">${user.full_name}</option>`;
        });

        // Bugünün tarihini varsayılan olarak ayarla
        document.getElementById('order_date').value = new Date().toISOString().split('T')[0];
        
        // Otomatik sipariş numarası
        document.getElementById('order_number').value = `SIP${Date.now()}`;

        document.getElementById('orderModal').style.display = 'block';
    } catch (error) {
        console.error('Sipariş modal açılırken hata:', error);
        document.getElementById('orderModal').style.display = 'block';
    }
}

// Sipariş form submit handler
document.addEventListener('DOMContentLoaded', function() {
    const orderForm = document.getElementById('orderForm');
    if (orderForm) {
        orderForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = {
                order_number: document.getElementById('order_number').value,
                customer_id: document.getElementById('order_customer_id').value,
                sales_rep_id: document.getElementById('order_sales_rep_id').value,
                order_date: document.getElementById('order_date').value,
                total_amount: document.getElementById('order_total_amount').value,
                notes: document.getElementById('order_notes').value
            };

            try {
                await apiCall('/api/orders', {
                    method: 'POST',
                    body: JSON.stringify(formData)
                });

                alert('Sipariş başarıyla oluşturuldu!');
                document.getElementById('orderForm').reset();
                closeModal('orderModal');
                showOrders();
            } catch (error) {
                alert('Hata: ' + error.message);
            }
        });
    }
});