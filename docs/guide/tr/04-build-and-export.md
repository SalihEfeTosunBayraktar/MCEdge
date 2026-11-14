# Derleme, çalıştırma ve dışa aktarma

## Motor seçin

Sağ üstteki motor menüsü derleyip çalıştırdığınız oyun sürümünü ve yükleyiciyi seçer. Her motor ilk seferde kendi Java ve Gradle'ını indirir; bu bir kez birkaç dakika sürer.

## Derleme ve çalıştırma

| Eylem | Nerede | Kısayol |
| --- | --- | --- |
| Seçili motoru derle | Derle ve çalıştır > Derle | Ctrl+B |
| Tüm motorları derle | Derle ve çalıştır > Tüm motorları derle | Ctrl+Shift+B |
| Minecraft'ı modla başlat | Derle ve çalıştır > İstemciyi çalıştır | F5 |
| Oyunu durdur | Derle ve çalıştır > İstemciyi durdur | Shift+F5 |
| Sunucu başlat | Derle ve çalıştır > Sunucuyu çalıştır | |
| Başka bir oyuncunun istemcisini başlat | Derle ve çalıştır > Başka bir istemci çalıştır... | |
| Çalışan sunucuya katıl | Derle ve çalıştır > Test sunucusuna katıl | |

**Derleme çıktısı** paneli her derlemenin ve çalıştırmanın günlüğünü gösterir. Üretilen koddaki hatalar onlara yol açan öğeyi gösterir.

Çok oyunculu test için sunucuyu, ardından farklı oyuncu adlarıyla (Dev, Dev2...) istemcileri başlatın: her birinin Derleme çıktısında kendi satırı ve kendi Durdur düğmesi vardır. Test sunucusu çevrimdışı modda çalışır; bu istemciler ona Çok oyunculu menüsünden ya da doğrudan Test sunucusuna katıl ile bağlanabilir.

## Modu dışa aktarın

**Dosya > Mod jar dosyasını dışa aktar...** (**Ctrl+E**) seçtiğiniz motorları derler ve her jar'ı belirlediğiniz ad kalıbıyla tek bir klasöre kopyalar. Jar'ı bir Minecraft `mods` klasörüne koyun ya da yükleyin.

Modunuzun ihtiyaç duyduğu diğer modlar **Çalışma alanı ayarları > Bağımlılıklar**'da listelenir; jar'ları deneme çalıştırmaları için indirilir.

## Çalışmanızı koruyun

**Sürüm kontrolü** projeyi Git ile kaydeder ve paylaşır. **Dosya > Çalışma alanını dosyaya aktar...** tüm projeyi zip dosyası yapar.

Tüm klavye kısayolları **Yardım > Klavye kısayolları**'nda listelenir.
