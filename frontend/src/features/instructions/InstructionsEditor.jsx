import { Editor } from '@tinymce/tinymce-react';

// TinyMCE self-hosted (licenza GPL)
import 'tinymce/tinymce';
import 'tinymce/icons/default';
import 'tinymce/themes/silver';
import 'tinymce/models/dom';
import 'tinymce/skins/ui/oxide/skin.min.css';
import contentCss from 'tinymce/skins/content/default/content.min.css?inline';
import contentUiCss from 'tinymce/skins/ui/oxide/content.min.css?inline';
import 'tinymce/plugins/advlist';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/link';
import 'tinymce/plugins/table';
import 'tinymce/plugins/code';
import 'tinymce/plugins/autoresize';

export default function InstructionsEditor({ initialValue, onReady }) {
    return (
        <Editor
            licenseKey="gpl"
            onInit={(_, editor) => onReady?.(editor)}
            initialValue={initialValue}
            init={{
                height: 600,
                menubar: false,
                branding: false,
                promotion: false,
                skin: false,
                content_css: false,
                content_style: contentCss + '\n' + contentUiCss,
                plugins: 'advlist lists link table code autoresize',
                toolbar:
                    'undo redo | blocks | ' +
                    'bold italic underline strikethrough | ' +
                    'bullist numlist outdent indent | ' +
                    'link table | removeformat | code',
                table_default_attributes: { border: '1' },
                table_default_styles: { 'border-collapse': 'collapse', width: '100%' },
                table_toolbar:
                    'tableprops tabledelete | ' +
                    'tableinsertrowbefore tableinsertrowafter tabledeleterow | ' +
                    'tableinsertcolbefore tableinsertcolafter tabledeletecol | ' +
                    'tablecellprops tablerowprops',
                statusbar: true,
                resize: true,
            }}
        />
    );
}
