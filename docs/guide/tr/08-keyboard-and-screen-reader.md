# Klavye ve ekran okuyucu

MCEdge'deki her işlem klavyeyle yapılabilir; denetimlerin ekran okuyucu için adı, rolü ve durumu vardır. **Yardım > Klavye kısayolları** her yerde çalışan tuşları listeler; her düzenleyicinin kendi listesi klavye düğmesinin (veya `?` tuşunun) arkasındadır.

## Gezinme

- **Tab** ve **Shift+Tab** sonraki ve önceki denetime geçer. Menü çubuğu, sekme şeridi, liste veya tablo tek duraktır; ok tuşları onun içinde gezdirir.
- **F10** veya tek başına basılıp bırakılan **Alt**, odağı menü çubuğuna alır. **Sol** ve **Sağ** menüyü değiştirir, **Aşağı** açar, **Esc** çıkar. Alt veya F10'a yeniden basmak da çıkarır.
- Açık bir menüde **Yukarı** ve **Aşağı**, **Home** ve **End** öğeler arasında gezer, bir harf o harfle başlayan sonraki öğeye atlar, **Enter** öğeyi çalıştırır, **Sol** ve **Sağ** komşu menüye geçer, **Esc** kapatır ve odak geldiği yere döner.
- Açık bir pencere odağı kendi içinde tutar. **Esc** kapatır (yanıtlamanız gereken soruları soran pencereler hariç) ve odak onu açan denetime döner.
- Odak her zaman görünür: denetimin çevresinde bir halka veya kutucukta ya da satırda renk değişimi. Tercihler > Erişilebilirlik'te daha kalın halkalı yüksek karşıtlıklı bir tema vardır.

## Listeler, kutucuklar ve tablolar

- Öğe kutucukları: **Sol**, **Sağ**, **Yukarı**, **Aşağı**, **Home** ve **End** sonraki kutucuğa geçer ve onu seçer; **Enter** açar, **F2** yeniden adlandırır, **Delete** siler.
- Tablolar (Ayrıntılar görünümü, etiketler, değişkenler, son projeler, çeviriler): Tab tabloya bir kez gider, **Yukarı** ve **Aşağı** (ve **Page Up**, **Page Down**, **Home**, **End**) seçili satırı değiştirir, **Enter** açar. Çeviri tablosu hücreler arasında dört okla gezer, **Enter** veya **F2** hücreyi düzenler.
- Seçenek listeleri (seçiciler, parça listeleri): ok tuşları odağı taşır, **Enter** veya **Boşluk** seçer.
- Sekme şeritleri (düzenleyici sayfaları, alt paneller): **Sol** ve **Sağ** sonraki sekmeye geçer ve gösterir. Açık düzenleyiciler şeridinde oklar yalnız odağı taşır; **Enter** düzenleyiciyi gösterir, **Delete** sekmeyi kapatır.

## Doku düzenleyici

Tab ile tuvale gidin. Sol üstte bir piksel imleci belirir; imleç gezdikçe konum ve renk okunur.

- **Ok tuşları** imleci bir piksel, **Shift** ile ok dört piksel taşır; **Home** ve **End** ilk ve son sütuna gider.
- **Boşluk**, imleçte seçili araçla fare düğmesine basar: kalem bir piksel boyar, doldurma doldurur, renk seçici rengi alır. **Boşluğu** basılı tutup oklarla çizgi, seçim veya şekil çizebilirsiniz; **Shift+Boşluk** siler. **Enter** şekli bitirir (çokgeni kapatır).
- Araç tuşları (**P**, **E**, **F**, **I**, **L**, **R**, **O**, **Y**, **M**), **G**, **+**, **-**, **Ctrl+Z** ve **Ctrl+S** her zamanki gibi çalışır. Klavye düğmesi hepsini listeler.

## Blok düzenleyici

Bloklar fare olmadan iki yolla eklenebilir:

- **Ctrl+F** blok aramasına gider; yazın, **Enter** en iyi eşleşmeyi seçili bloğun altına ekler.
- **Tab** araç kutusuna gider; ok tuşları kategorilerde gezer, **Sağ** kategorinin bloklarına girer, **Enter** seçili bloğu ekler ve taşıma kipine alır: oklar nereye bağlanacağını seçer, **Enter** yeri onaylar.

Tuvalde ok tuşları blok blok ve girişlerine geçer, **Enter** alanı düzenler, **M** seçili bloğu taşır, **X** yığınından ayırır, **I** okur, **Delete** siler, **T** ve **W** araç kutusuna ve tuvale atlar.

## GUI yerleşim düzenleyicisi

**Page Up** ve **Page Down** önceki ve sonraki parçayı seçer (veya parça listesinde Tab ve Enter ile seçin), **ok tuşları** onu bir piksel taşır (**Shift** ızgara kadar), **F2** yeniden adlandırır, **Delete** siler, **Esc** seçimi kaldırır.

## Ekran okuyucular

Alanların, düğmelerin, menülerin, sekme şeritlerinin, listelerin, tabloların ve pencerelerin adı, rolü ve durumu (seçili, açık, işaretli) vardır. Bir alanı etiketi adlandırır. Kayıt durumu ve doku düzenleyicideki imleç konumu değiştikçe duyurulur. Denetimler, Chromium'un ekran okuyucuya verdiği erişilebilirlik ağacına karşı çalışır; neyin denetlendiğinin listesi `docs/A11Y-AUDIT.md` içindedir.
