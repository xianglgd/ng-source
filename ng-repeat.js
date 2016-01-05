'use strict';
/****************************
<p ng-repeat-start="(key,value) in list as result track by value.id"></p>
  <span></span>
<p ng-repeat-end></p>
下面所提到的block 即为对上面整体ng-repeat的一个封装。
list中有多少项,就会生成多少 block.

lastBlockMap 用来存储上一次 block的值
nextBlockMap 用来存储这次 block的值,在生成完毕后会赋值给 lastBlockMap.
每次循环都先把需要遍历的key 找到存入 collectionKeys 中.
然后从 0到length-1 线性循环。 通过trackByIdFn得到唯一标识id。
然后从 lastBlockMap 中找到是此id的block,赋值给 nextBlockMap。然后delete掉。
如果lastBlockMap中没有,就看是否和 nextBlockMap 发生冲突.
如果没有 就新建一个block,存入 nextBlockMap 中。

遍历 lastBlockMap ,把那些不用的 block 删掉.

再从 0到length-1 线性循环 collectionKeys。 通过trackByIdFn得到唯一标识id。
进行 nextBlockMap 的赋值,既作用域更新,元素的移动.

ps:collectionKeys 是根据你 list 从前往后取值.
所以可以保持元素位置的和list 一致。
****************************/
var ngRepeatDirective = ['$parse', '$animate', function($parse, $animate) {
  var NG_REMOVED = '$$NG_REMOVED'; //用来标识一个block是否已被移除的key
  var ngRepeatMinErr = minErr('ngRepeat'); 

  //更新一个 block 的scope的函数。
  var updateScope = function(scope, index, valueIdentifier, value, keyIdentifier, key, arrayLength) {
    // TODO(perf): generate setters to shave off ~40ms or 1-1.5%
    scope[valueIdentifier] = value;
    if (keyIdentifier) scope[keyIdentifier] = key;
    scope.$index = index;
    scope.$first = (index === 0);
    scope.$last = (index === (arrayLength - 1));
    scope.$middle = !(scope.$first || scope.$last);
    // jshint bitwise: false
    scope.$odd = !(scope.$even = (index&1) === 0);
    // jshint bitwise: true
  };

  var getBlockStart = function(block) {
    return block.clone[0];
  };

  var getBlockEnd = function(block) {
    return block.clone[block.clone.length - 1];
  };


  return {
    restrict: 'A',
    multiElement: true,// 是多个元素 ，说白了就是可以用 ng-repeat-start ng-repeat-end
    transclude: 'element',//需要原来的内容,包括自身。如果为true 则只取其内容.
    // <span ng-repeat="item in list"><div></div></span>
    // 为 true时: <div></div>
    // 为element时: <span ng-repeat="item in list"><div></div></span>
    priority: 1000,
    terminal: true, //截断其子元素和其上优先级低于 1000的所有指令的编译
    $$tlb: true, //不知道是撒
    compile: function ngRepeatCompile($element, $attr) {
      var expression = $attr.ngRepeat; //拿到 ng-repeat 的表达式
      var ngRepeatEndComment = document.createComment(' end ngRepeat: ' + expression + ' '); //创建一个注释 

      var match = expression.match(/^\s*([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+track\s+by\s+([\s\S]+?))?\s*$/);
      //用正则匹配ng-repeat表达式.

      if (!match) {
        throw ngRepeatMinErr('iexp', "Expected expression in form of '_item_ in _collection_[ track by _id_]' but got '{0}'.",
            expression);
      }

      var lhs = match[1]; //匹配 (key, value)
      var rhs = match[2]; // 匹配 in list 中的 list
      var aliasAs = match[3]; // 匹配 as result 中的 reault
      var trackByExp = match[4]; //匹配 track by id 中的 id 

      match = lhs.match(/^(?:(\s*[\$\w]+)|\(\s*([\$\w]+)\s*,\s*([\$\w]+)\s*\))$/);
      //匹配(key,value) 把key,value 分别拿到
      if (!match) {
        throw ngRepeatMinErr('iidexp', "'_item_' in '_item_ in _collection_' should be an identifier or '(_key_, _value_)' expression, but got '{0}'.",
            lhs);
      }
      var valueIdentifier = match[3] || match[1]; //value 的表达式
      var keyIdentifier = match[2]; // key 的表达式

      if (aliasAs && (!/^[$a-zA-Z_][$a-zA-Z0-9_]*$/.test(aliasAs) ||
          /^(null|undefined|this|\$index|\$first|\$middle|\$last|\$even|\$odd|\$parent|\$root|\$id)$/.test(aliasAs))) {
        throw ngRepeatMinErr('badident', "alias '{0}' is invalid --- must be a valid JS identifier which is not a reserved name.",
          aliasAs);
      }

      var trackByExpGetter, //$parse 解析 track by 后面表达式后得到的函数
          trackByIdExpFn, // 得到运行中 track by 真正的值,即和解析后得到的dom相关的唯一标识。
          trackByIdArrayFn, //是 array 时得到的唯一标识。
          trackByIdObjFn; //是 obj 时得到的唯一标识
      var hashFnLocals = {$id: hashKey}; 
      //定义一个trackByIdExpFn运行时所依赖的一个对象. hashKey 是生成一个id的函数
      /******************************************
      angular 需要一个唯一标识 用来把 数据和DOM相关联.
      如果写了track by , 就会解析 track by 的表达式。得到一个解析函数 trackByExpGetter.
        在link 阶段定义 trackByIdExpFn ,其中 为 hashFnLocals 添加一些属性后,在当前作用域上运行
        trackByExpGetter($scope, hashFnLocals),并把结果返回,得到唯一标识.
        hashFnLocals 添加的属性为 key(如果有 ),value,$index.
        上面的key,value 只是对应的表达式. 我们写ng-repeat 时可以这样写
        <span ng-repeat="(key,value) in list track by key"></span>
        <span ng-repeat="(key,value) in list track by value"></span>
        <span ng-repeat="(key,value) in list track by $index"></span>
        <span ng-repeat="(key,value) in list track by $id($item)"></span>
        <span ng-repeat="(aaa,bbb) in list track by aaa"></span>
        <span ng-repeat="(aaa,bbb) in list track by bbb"></span>

      如果没写track by 
        如果list是一个[],数组。
          那么就会执行 trackByIdArrayFn 来得到唯一的key.hashKey(value);
          把数组的value拿到,然后运行 hashKey .如果数组的 value是一个 object。
          那就添加一个 $$hashKey:"object:**", 然后靠 $$hashKey来追踪。
        如果list是一个对象。
          就直接按这个数组的key来追踪。
      *******************************************/

      if (trackByExp) {
        trackByExpGetter = $parse(trackByExp);
      } else {
        trackByIdArrayFn = function(key, value) {
          return hashKey(value);
        };
        trackByIdObjFn = function(key) {
          return key;
        };
      }

      return function ngRepeatLink($scope, $element, $attr, ctrl, $transclude) {

        if (trackByExpGetter) {
          trackByIdExpFn = function(key, value, index) {
            // assign key, value, and $index to the locals so that they can be used in hash functions
            if (keyIdentifier) hashFnLocals[keyIdentifier] = key;
            hashFnLocals[valueIdentifier] = value;
            hashFnLocals.$index = index;
            return trackByExpGetter($scope, hashFnLocals);
          };
        }

        // Store a list of elements from previous run. This is a hash where key is the item from the
        // iterator, and the value is objects with following properties.
        //   - scope: bound scope
        //   - element: previous element.
        //   - index: position
        //
        // We are using no-proto object so that we don't need to guard against inherited props via
        // hasOwnProperty.
        var lastBlockMap = createMap();
        /**********************************
        lastBlockMap用来把之前运行结果保存下来,key 就是 track by 的唯一标识.value是如下值
          scope: 该块的scope.
          element: 和该id相对应的element
          index: 位置
        我们使用 没有继承的object. 这样我们就不需要提防继承属性了.
        shit ,,,,,,,,,,他写的有问题. 
        里面是以 id 为key 但是属性不是以上三个. lastBlockMap真实为
        {
          id:{
            scope:, 该block 对应的新的作用域
            clone:, 该block 对应的 dom 。
            id:,    该block 通过 track 函数得到的唯一索引
          }
        }
        **********************************/ 


        //watch props
        /**************************************
        使用 watchCollection 来检测 list的变化。 
        watchCollection只监视list本身,和list下面一层的变化.
        为何只检测一层？因为下面的第二层,三层。交由 生成的对应的block去检测。
        这些block检测不到第一层的变化,而作为list也只需要关心自身的变化.
        每个block生成一个新 scope, 在其对应的scope上监听属性。
        
        说白了:
        有个大watch,作为一切的统筹,监听list,生成block. dom的更新.
        没生成一个block,这个block作用域都是其对应value,并且外加了一些 属性($index,$odd 之类)。
        每个block再去监听其自己的属性。
        block 无法监听 list变动. list变动直接改变block,都变了,不再是你自己了,还怎么监听吗？
        举个例子:
        都写 <span ng-bind="name"></span>
        我们 $scope.name = "asdas". 有人写 $scope={} 吗？
        block职责是监听 list[0] 并不是监听list.
        **************************************/
        $scope.$watchCollection(rhs, function ngRepeatAction(collection) {
          var index, length,
              previousNode = $element[0],     // node that cloned nodes should be inserted after
                                              // initialized to the comment node anchor
              nextNode,
              // Same as lastBlockMap but it has the current state. It will become the
              // lastBlockMap on the next iteration.
              // 和 lastBlockMap 一样,当时它存的是当前block状态.在最后他讲变成lastBlockMap
              nextBlockMap = createMap(),
              collectionLength,
              key, value, // key/value of iteration 。collection中的 key-value
              trackById, /* 
                collection中每一项 track by 所得到的唯一id。通过trackByIdFn计算得出
                track by key ,trackById 就是 key.
                track by value.id, trackById 就是 value.id(collection[key]["id"])
              */
              trackByIdFn,
              collectionKeys,
              block,       // last object information {scope, element, id}
              nextBlockOrder, //用数组的形式从新存储一遍 nextBlockMap
              elementsToRemove;
              /******************************************
              nextBlockMap 可能是 {
                lg:block1,
                pp:block2
              }
              nextBlockOrder 就是 [block1,block2]
              由于后面均是 for(i=0;i<k;i++) 形式的循环,因此需要一个数组形式的存储.
              Q1: 为何不能直接用 for in的循环？
              A1: 可以直接用for in,collectionKeys中存 key:true,这样collectionKeys就为
              {
                key1:true,key2:true
              }
              目前 collectionKeys 为 [key1,key2]。
              这样后面就都可以用 for in 循环了。
              但是 for in 效率 没for高。并且for in 有一些坑,
              {toString:"bbb"};
              上面那个对象,在 ie6/7/8中,用for in 不能循环出toString.
              还有一个最重要原因, for in 无法控制顺序。会导致后面插入element不可控.

              Q2:新建一个数组浪费空间呀。
              A2:说的就如果你新建一个对象存key不浪费一样？ 
              并且数组中每一项都是对像的引用,并没浪费多大存储空间.
              ******************************************/
          if (aliasAs) { //如果有 as result ,那么就给 scope中添加这个字段.
            $scope[aliasAs] = collection;
          }

          if (isArrayLike(collection)) {
            /******************************************************
            如果监听的是一个类数组对象,就把 该对象赋值给 collectionKeys.
            为何赋值给 collectionKeys ? 因为省内存呀，，，，后面用 === 恒等判断,
            就可以直接拿到 key(也就是对应的index). 
            如果这里为了保持统一 写成如下:
            for(var i = 0,k= collection.length-1; i<=k ;i++){
              collectionKeys.push(i);
            }
            也可以,后面可以直接通过 collectionKeys[index].
            但是浪费内存呀。
            其实这里 collectionKeys = collection; 
            更相当于一个flag. 后面判断 collectionKeys === collection。 
            就可以确定是用 index 还是用 collectionKeys[index]
            track by 在之前已经说明。请看第99行的注释。
            *******************************************************/
            collectionKeys = collection;
            trackByIdFn = trackByIdExpFn || trackByIdArrayFn;
          } else {
            trackByIdFn = trackByIdExpFn || trackByIdObjFn;
            // if object, extract keys, in enumeration order, unsorted
            //如果是一个对象,就直接枚举出他的key,不进行排序.
            //ps:angular以前的版本好像对key进行排序
            /************************************************
            枚举出所有该对象的key(非继承属性,不能以 $ 开头)
            然后把这些key push到 collectionKeys中,后续使用.
            itemKey.charAt(0) !== '$' 
            上面这句话,也就是为何 obj={$name:"****"} ng-repeat不能遍历出 $name的原因.
            估计 angular 把所有 $ 开头的都当作私有属性了.
            ************************************************/
            collectionKeys = [];
            for (var itemKey in collection) {
              if (hasOwnProperty.call(collection, itemKey) && itemKey.charAt(0) !== '$') {
                collectionKeys.push(itemKey);
              }
            }
          }

          //拿到需要遍历的key的长度
          collectionLength = collectionKeys.length;
          nextBlockOrder = new Array(collectionLength);
          //新建一个该长度的数组

          // locate existing items
          /**************************************
          找出存在的items。下面这个for循环的功能是:
          把当前监听的 collection 中需要遍历的key循环一遍.这些key都存在 collectionKeys之中。
          PS:collectionLength 为 collectionKeys.length。 collectionKeys在241中有写。
          拿到key,获得这个key所对应的item track by时对应的值 id(这个id就是 track by 的值。也是 数据与dom关联的唯一索引)。
            如果这个id之前存在.
              找到这个id之前的block(lastBlockMap[trackById]). 
              把这个block保存到当前block(nextBlockMap)中. 
              删除lastBlockMap中保存的。lastBlockMap[trackById];
            如果这个id已经存在.
              修复已经删除的 lastBlockMap 中的值。然后报错.
            如果这个id从来没出现过
              就进行初始化.
          **************************************/
          for (index = 0; index < collectionLength; index++) {
            key = (collection === collectionKeys) ? index : collectionKeys[index];
            value = collection[key];
            trackById = trackByIdFn(key, value, index);
            if (lastBlockMap[trackById]) {
              // found previously seen block
              //如果之前存在的block
              block = lastBlockMap[trackById];
              delete lastBlockMap[trackById];
              //把该block从之前的block中删除。并且赋值给 当前的block
              nextBlockMap[trackById] = block;
              nextBlockOrder[index] = block;
            } else if (nextBlockMap[trackById]) {
              // if collision detected. restore lastBlockMap and throw an error
              //如果检测到冲突,就回复之前已删除的block(lastBlockMap),并且报错。
              forEach(nextBlockOrder, function(block) {
                if (block && block.scope) lastBlockMap[block.id] = block;
              });
              throw ngRepeatMinErr('dupes',
                  "Duplicates in a repeater are not allowed. Use 'track by' expression to specify unique keys. Repeater: {0}, Duplicate key: {1}, Duplicate value: {2}",
                  expression, trackById, value);
            } else {
              // new never before seen block
              //一个从来没见过的block
              nextBlockOrder[index] = {id: trackById, scope: undefined, clone: undefined};
              nextBlockMap[trackById] = true;
            }
          }

          // remove leftover items
          //一次循环完毕,删除之前剩下的 block .
          for (var blockKey in lastBlockMap) {
            block = lastBlockMap[blockKey];
            elementsToRemove = getBlockNodes(block.clone);
            //把这个block的所有元素获得到。
            $animate.leave(elementsToRemove);
            if (elementsToRemove[0].parentNode) {
              // if the element was not removed yet because of pending animation, mark it as deleted
              // so that we can ignore it later
              //如果element还没被移除,是因为动画效果的延迟.
              //标记他们为已移除状态,这样我们就可以在等等忽略它.
              for (index = 0, length = elementsToRemove.length; index < length; index++) {
                elementsToRemove[index][NG_REMOVED] = true;
              }
            }
            block.scope.$destroy();//把这个block的作用域销毁
          }

          // we are not using forEach for perf reasons (trying to avoid #call)
          for (index = 0; index < collectionLength; index++) {
            key = (collection === collectionKeys) ? index : collectionKeys[index];
            value = collection[key];
            block = nextBlockOrder[index];

            if (block.scope) {
              // if we have already seen this object, then we need to reuse the
              // associated scope/element
              //如果这个block以前已经存在,我们需要重复使用它来联系scope和dom.
              nextNode = previousNode;
              // nextNode 为前一个block的最后一个元素.
              // 下面的do while 会先执行nextNode = nextNode.nextSibling;
              // 就得到当前block的第一个元素了

              // skip nodes that are already pending removal via leave animation
              //跳过那些正在被移除的node. angular移除元素用的 $animate.不懂呀,直接移除不快一些？
              // 我也看不见撒动画效果呀。
              do {
                nextNode = nextNode.nextSibling;
              } while (nextNode && nextNode[NG_REMOVED]);

              if (getBlockStart(block) != nextNode) {
                // existing item which got moved
                /************************************************
                这是移动block的关键。
                举个例子 item in list track by item.id 
                list = [{id:1},{id:2}];
                现在 dom为 ele[0] <span>1</span>,<span>2</span>. 
                如果 list = [{id:2},{id:1}];
                此时 listBlockMap 与 nextBlock 是 {
                    1:{
                      clone:<span>1</span>,scope:,id:1
                    },
                    2:{
                      clone:<span>2</span>,scope:,id:2
                    }
                }
                但是 index从0开始循环。既先拿到的block 为 {clone:<span>2</span>,scope:,id:2}
                此时的previousNode为 ele[0],ng-repeat的起始位置。
                  可以理解为所有ng-repeat产生的元素的最前面的位置
                执行一句 nextNode = nextNode.nextSibling; 后
                nextNode 就为 <span>1</span>.
                但是 getBlockStart(block) ,当前block为 {clone:<span>2</span>,scope:,id:2}。
                所有拿到的是 <span>2</span>。
                <span>2</span> != <span>1</span>.
                所以执行下面这句,把当前block的元素移动到 previousNode后面,也就是 ele[0] 后面。
                于是得到 ele[0]<span>2</span><span>1</span>。
                继续后面的执行 previousNode = getBlockEnd(block);
                于是 previousNode = <span>2</span>;

                第二次循环 nextNode = previousNode; nextNode = nextNode.nextSibling;
                nextNode为 <span>1</span>;
                此时index为1,拿到的block为 {clone:<span>1</span>,scope:,id:1}
                getBlockStart(block) 得到的结果为 <span>1</span>。
                <span>1</span> 和 nextNode一样。 所以不需要移动。

                并且他还跳过了一些在 lastBlockMap中正在删除的元素。
                不得不是,这代码逻辑处理 真的是 牛逼爆了。
                ************************************************/
                $animate.move(getBlockNodes(block.clone), null, jqLite(previousNode));
              }
              previousNode = getBlockEnd(block);
              //previousNode 取值为当前block的最后一个元素。下次循环时使用
              updateScope(block.scope, index, valueIdentifier, value, keyIdentifier, key, collectionLength);
              //更新改block的scope.此时该block上的检测就将起作用了
            } else {
              // new item which we don't know about
              //当这个item是没出现过的.就执行 $transclude 嵌入函数。
              //$transclude请自行在网上脑补。
              //下面的用法为,  编译模版本身,得到一个编译后的dom,并且把dom绑定到一个新的scope上.
              $transclude(function ngRepeatTransclude(clone, scope) {
                block.scope = scope;
                // http://jsperf.com/clone-vs-createcomment
                var endNode = ngRepeatEndComment.cloneNode(false);
                clone[clone.length++] = endNode;
                //把编译后的dom元素的末尾添加一个注释.站位符.
                // TODO(perf): support naked previousNode in `enter` to avoid creation of jqLite wrapper?
                $animate.enter(clone, null, jqLite(previousNode));
                //把dom插入到前一个block最后一个元素的后面

                previousNode = endNode;
                //再将previousNode 指向当前block的最后一个元素


                // Note: We only need the first/last node of the cloned nodes.
                // However, we need to keep the reference to the jqlite wrapper as it might be changed later
                // by a directive with templateUrl when its template arrives.

                /************************************************
                我们只需要这些cloned元素的第一个和最后一个。然而,我们需要保持 jqlite的封装性,
                因为可能会被 templateUrl 异步加载回来的 template 所改变。
                ************************************************/
                block.clone = clone;
                nextBlockMap[block.id] = block;
                //block赋值完毕 ,然后nextBlockMap中添加该block
                updateScope(block.scope, index, valueIdentifier, value, keyIdentifier, key, collectionLength);
                //更新改block的scope.此时该block上的检测就将起作用了
              });
            }
          }
          lastBlockMap = nextBlockMap;
          //最后 把 nextBlockMap 赋值给 lastBlockMap
        });
      };
    }
  };
}];
